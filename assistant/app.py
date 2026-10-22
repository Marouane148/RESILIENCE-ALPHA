"""Assistant opérateur : modèle local (Ollama) + LangChain + recherche documentaire (RAG).

Il répond aux questions des opérateurs à partir des procédures et de l'architecture du dépôt.
Il n'a accès ni au socket Docker, ni à la base, ni à aucun outil : il lit des documents et produit du texte.
"""
import logging
import os
import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.vectorstores import InMemoryVectorStore
from langchain_ollama import ChatOllama, OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("assistant")

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
CHAT_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b")
EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
KNOWLEDGE_DIR = Path(os.environ.get("KNOWLEDGE_DIR", "/knowledge"))
TOP_K = int(os.environ.get("RAG_TOP_K", "3"))
MIN_SCORE = float(os.environ.get("RAG_MIN_SCORE", "0.6"))
STRONG_SCORE = float(os.environ.get("RAG_STRONG_SCORE", "0.7"))

# Un score moyen n'est retenu que si la question parle bien de la plateforme (les embeddings seuls ne séparent pas assez le hors-sujet).
DOMAIN_TERMS = re.compile(
    r"alerte|api|waf|vault|secret|prometheus|grafana|loki|alertmanager|ansible|remediat|docker|conteneur|postgres|base de donn|"
    r"panne|reprise|incident|attaque|rafale|injection|anomalie|isolation|forest|face id|passkey|webauthn|biom|paiement|payment|"
    r"resilience|runbook|nis2|dora|ebios|pca|pra|rto|rpo|s[ée]curit|sauvegarde|healthy|health|log|assistant|ollama|mod[eè]le|d[ée]tect",
    re.IGNORECASE,
)

# Demande d'action à l'impératif ("exécute", "redémarre", "arrête"...) : l'assistant n'agit jamais, il explique.
ACTION_REQUEST = re.compile(
    r"^\s*(?:peux-tu |tu peux |pouvez-vous |vous pouvez |s'il (?:te|vous) pla[iî]t,? )?"
    r"(ex[ée]cute[rz]?|lance[rz]?|red[ée]marre[rz]?|arr[êe]te[rz]?|stoppe[rz]?|supprime[rz]?|efface[rz]?|tue[rz]?|kill|restart|stop)\b",
    re.IGNORECASE,
)
ACTION_REFUSAL = (
    "Je ne peux exécuter aucune action sur le système : je suis un assistant en lecture seule. "
    "La remédiation de disponibilité est assurée par l'automate (Ansible) ; les autres actions sont à la main de l'opérateur. "
    "Consultez le runbook (section « Commandes utiles ») pour la procédure documentée."
)
NO_ANSWER = (
    "Je ne trouve pas cette information dans la documentation de la plateforme (runbook, architecture, sécurité). "
    "Je ne réponds qu'aux questions sur Resilience-Alpha : incidents, alertes, reprise, architecture. "
    "Consultez Grafana ou le runbook."
)

PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "Tu es l'assistant des opérateurs de la plateforme de paiement fictive Resilience-Alpha. "
        "Réponds en français, de façon brève et concrète, uniquement à partir du CONTEXTE ci-dessous. "
        "Si le contexte ne contient pas la réponse, dis-le et indique où chercher (Grafana, runbook). "
        "Tu ne peux exécuter aucune action sur le système : tu expliques les procédures, sans jamais inventer de commande.\n\n"
        "CONTEXTE :\n{context}",
    ),
    ("human", "{question}"),
])

state = {"store": None, "chunks": 0, "error": None}
app = FastAPI(title="Resilience-Alpha operator assistant", docs_url=None, redoc_url=None)


class Question(BaseModel):
    question: str = Field(min_length=3, max_length=500)


def load_documents() -> list[Document]:
    documents = []
    for path in sorted(KNOWLEDGE_DIR.rglob("*.md")):
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
        if text:
            documents.append(Document(page_content=text, metadata={"source": str(path.relative_to(KNOWLEDGE_DIR))}))
    return documents


def warm_up_model() -> None:
    """Charge le modèle en mémoire dès le démarrage : le premier chargement peut prendre plus d'une minute sur CPU."""
    try:
        ChatOllama(model=CHAT_MODEL, base_url=OLLAMA_URL, num_predict=1, client_kwargs={"timeout": 170}).invoke("ok")
        log.info("model %s loaded", CHAT_MODEL)
    except Exception as error:  # noqa: BLE001
        log.warning("model warm-up skipped: %s", str(error)[:160])


def build_index() -> None:
    """Construit l'index vectoriel ; réessaie tant que les modèles Ollama ne sont pas téléchargés."""
    while state["store"] is None:
        try:
            documents = load_documents()
            chunks = RecursiveCharacterTextSplitter(chunk_size=600, chunk_overlap=80).split_documents(documents)
            store = InMemoryVectorStore(OllamaEmbeddings(model=EMBED_MODEL, base_url=OLLAMA_URL))
            store.add_documents(chunks)
            state.update(store=store, chunks=len(chunks), error=None)
            log.info("index ready: %d documents, %d chunks", len(documents), len(chunks))
            warm_up_model()
        except Exception as error:  # noqa: BLE001 - Ollama peut être en cours de téléchargement des modèles
            state["error"] = str(error)[:200]
            log.warning("index not ready yet: %s", state["error"])
            time.sleep(10)


@app.on_event("startup")
def start_indexing() -> None:
    threading.Thread(target=build_index, daemon=True).start()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "index_ready": state["store"] is not None, "chunks": state["chunks"], "model": CHAT_MODEL, "detail": state["error"]}


@app.post("/ask")
def ask(body: Question) -> dict:
    if state["store"] is None:
        raise HTTPException(status_code=503, detail="index not ready: models are still downloading")

    if ACTION_REQUEST.match(body.question):
        log.info("action request refused")
        return {"answer": ACTION_REFUSAL, "sources": [{"source": "docs/RUNBOOK-INCIDENT.md", "excerpt": "Commandes utiles"}], "model": CHAT_MODEL}

    scored = state["store"].similarity_search_with_score(body.question, k=TOP_K)
    log.info("retrieval scores: %s", [round(score, 3) for _, score in scored])
    best = max((score for _, score in scored), default=0.0)
    relevant = best >= STRONG_SCORE or (best >= MIN_SCORE and DOMAIN_TERMS.search(body.question) is not None)
    hits = [hit for hit, score in scored if score >= MIN_SCORE] if relevant else []
    if not hits:
        return {"answer": NO_ANSWER, "sources": [], "model": CHAT_MODEL}
    context = "\n\n".join(f"[{hit.metadata['source']}]\n{hit.page_content}" for hit in hits)
    llm = ChatOllama(model=CHAT_MODEL, base_url=OLLAMA_URL, temperature=0.1, num_predict=260, client_kwargs={"timeout": 170})
    try:
        answer = (PROMPT | llm).invoke({"context": context, "question": body.question}).content
    except Exception as error:  # noqa: BLE001
        log.warning("generation failed: %s", error)
        raise HTTPException(status_code=503, detail="language model unavailable") from error

    sources = []
    for hit in hits:
        if hit.metadata["source"] not in [source["source"] for source in sources]:
            sources.append({"source": hit.metadata["source"], "excerpt": hit.page_content[:160].replace("\n", " ")})
    return {"answer": answer.strip(), "sources": sources, "model": CHAT_MODEL}
