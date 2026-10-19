FROM python:3.12-alpine

RUN apk add --no-cache docker-cli && \
    pip install --no-cache-dir ansible-core requests docker && \
    ansible-galaxy collection install community.docker

WORKDIR /workspace
COPY ansible /workspace/ansible
COPY ansible/remediator.py /workspace/remediator.py

CMD ["python", "/workspace/remediator.py"]
