FROM mysql:8.0

COPY ./custom.conf /etc/mysql/conf.d/mysql.cnf
RUN apt-get -y update
RUN apt-get -y install wget
RUN wget https://github.com/percona/percona-toolkit/archive/3.0.5-test.tar.gz
RUN tar zxvf 3.0.5-test.tar.gz
RUN ./percona-toolkit-3.0.5-test/bin/pt-query-digest --version
RUN mv ./percona-toolkit-3.0.5-test/bin/pt-query-digest /usr/local/bin/pt-query-digest


CMD ["mysqld"]