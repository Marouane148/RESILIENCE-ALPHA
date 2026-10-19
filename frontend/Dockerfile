FROM node:22-alpine AS build

WORKDIR /app
ARG VITE_API_TOKEN
ENV VITE_API_TOKEN=$VITE_API_TOKEN
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
