FROM lapig/app_base:stable_1.4

# Clone app and npm install on server
ENV URL_TO_APPLICATION_GITHUB="https://github.com/lapig-ufg/tvi.git"
ENV BRANCH="master"

LABEL maintainer="Renato Gomes <renatogomessilverio@gmail.com> Rocha Jairo <devjairomr.gmail.com.br>"

RUN if [ -d "/APP/tvi" ]; then rm -Rf /APP/tvi; fi  && \
    cd /APP && git clone -b ${BRANCH} ${URL_TO_APPLICATION_GITHUB}

RUN pip install pyproj shapely

ADD ./src/server/bin/bbox.py /usr/bin/bbox
RUN chmod +x /usr/bin/bbox

ADD ./src/server/node_modules /APP/tvi/src/server/node_modules  
#ADD ./src/client/dist/client /APP/tvi/src/client/dist/client
#COPY ./version.jso* /APP/tvi/src/client/dist/client/assets/

CMD [ "/bin/bash", "-c", "/APP/tvi/src/server/prod-start.sh; tail -f /APP/tvi/src/server/app.out"]

ENTRYPOINT [ "/APP/Monitora.sh"]