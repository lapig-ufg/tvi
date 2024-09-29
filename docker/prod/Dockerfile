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

# Remove o CMD anterior e combine a execução dos scripts no ENTRYPOINT
ENTRYPOINT ["/bin/bash", "-c", "/APP/monitor.sh"]