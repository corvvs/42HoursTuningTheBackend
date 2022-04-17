FROM mysql:8.0

COPY ./custom.conf /etc/mysql/conf.d/mysql.cnf

CMD ["mysqld", "--innodb-log-file-size=512M", "--max_connections=500"]
