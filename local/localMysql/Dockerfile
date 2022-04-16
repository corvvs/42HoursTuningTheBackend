FROM mysql:8.0

COPY ./custom.conf /etc/mysql/conf.d/mysql.cnf
COPY ./sql/V0.sql /docker-entrypoint-initdb.d/1_init.sql
COPY ./sql/2_loadTestData.sql /docker-entrypoint-initdb.d/
COPY ./data/* /docker-entrypoint-initdb.d/

RUN apt-get -y update
RUN apt-get -y install wget
RUN wget https://github.com/percona/percona-toolkit/archive/3.0.5-test.tar.gz
RUN tar zxvf 3.0.5-test.tar.gz
RUN ./percona-toolkit-3.0.5-test/bin/pt-query-digest --version
RUN mv ./percona-toolkit-3.0.5-test/bin/pt-query-digest /usr/local/bin/pt-query-digest
RUN wget http://mysqltuner.pl/ -O mysqltuner.pl

CMD ["mysqld", "--innodb-log-file-size=512M", "--max_connections=2000"]
