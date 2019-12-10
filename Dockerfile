FROM node:latest
MAINTAINER Nossas <tech@nossas.org>

RUN mkdir /code
WORKDIR /code

COPY . /code

CMD ["yarn", "start"]
