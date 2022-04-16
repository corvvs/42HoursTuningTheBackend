#!/bin/bash

# ===========================
# localMysql用に、一部ファイルをdevelopmentからコピーする
# ===========================

cp ../development/mysql/sql/V*.sql ./localMysql/sql/
cp ../development/mysql/custom.conf ./localMysql/custom.conf