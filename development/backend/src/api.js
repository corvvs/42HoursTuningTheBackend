const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const jimp = require('jimp');

const mysql = require('mysql2/promise');

const sprint = (name) => {
  console.log(`${Date.now()}: ${name}`);
};

const readFilePromise = (path) => {
  return new Promise((res, rej) => {
    fs.readFile(path, (err, data) => {
      if (err) {
        rej(err);
      } else {
        res(data);
      }
    });
  });
}

const writeFilePromise = (path, binary) => {
  return new Promise((res, rej) => {
    fs.writeFile(path, binary, (err) => {
      if (err) {
        rej(err);
      } else {
        res();
      }
    });
  });
}

// MEMO: 設定項目はここを参考にした
// https://github.com/sidorares/node-mysql2#api-and-configuration
// https://github.com/mysqljs/mysql
const mysqlOption = {
  host: 'mysql',
  user: 'backend',
  password: 'backend',
  database: 'app',
  waitForConnections: true,
  connectionLimit: 10,
};
const pool = mysql.createPool(mysqlOption);

const mylog = (obj) => {
  if (Array.isArray(obj)) {
    for (const e of obj) {
      console.log(e);
    }
    return;
  }
  console.log(obj);
};

const getLinkedUser = async (headers) => {
  const target = headers['x-app-key'];
  mylog(target);
  const qs = `select linked_user_id from session where value = ? limit 2`;

  const [rows] = await pool.query(qs, [`${target}`]);

  if (rows.length !== 1) {
    mylog('セッションが見つかりませんでした。');
    return undefined;
  }

  return { user_id: rows[0].linked_user_id };
};

const filePath = 'file/';

// POST /records
// 申請情報登録
const postRecords = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const body = req.body;

  let [rows] = await pool.query(
    `select * from group_member where user_id = ?
    AND is_primary = true`,
    [user.user_id],
  );

  if (rows.length !== 1) {
    mylog('申請者のプライマリ組織の解決に失敗しました。');
    res.status(400).send();
    return;
  }

  const now = new Date();
  const userPrimary = rows[0];
  const newId = uuidv4();
  const record_fields = [
    newId,
    body.title,
    body.detail,
    body.categoryId,
    userPrimary.group_id,
    user.user_id,
  ]
  const item_files = body.fileIdList.map(e => [
    newId, e.fileId, e.thumbFileId, now,
  ]);
  const insert_result = await Promise.all([
    pool.query(
      `insert into record
        (record_id, status, title, detail, category_id, application_group, created_by, created_at, updated_at)
        values (?, "open", ?, ?, ?, ?, ?, now(), now())`,
        [...record_fields],
    ),
    pool.query(
      `insert into record_item_file
        (linked_record_id, linked_file_id, linked_thumbnail_file_id, created_at)
        values ?`,
      [item_files],
    ),
  ]);
  // console.log(insert_result);
  res.send({ recordId: newId });
};

// GET /records/{recordId}
// 文書詳細取得
const getRecord = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;

  const recordQs = `select * from record where record_id = ?`;

  const [recordResult] = await pool.query(recordQs, [`${recordId}`]);

  if (recordResult.length !== 1) {
    res.status(404).send({});
    return;
  }

  let recordInfo = {
    recordId: '',
    status: '',
    title: '',
    detail: '',
    categoryId: null,
    categoryName: '',
    applicationGroup: '',
    applicationGroupName: null,
    createdBy: null,
    createdByName: null,
    createdByPrimaryGroupName: null,
    createdAt: null,
    files: [],
  };

  const searchPrimaryGroupQs = `select * from group_member where user_id = ? and is_primary = true`;
  const searchUserQs = `select * from user where user_id = ?`;
  const searchGroupQs = `select * from group_info where group_id = ?`;
  const searchCategoryQs = `select * from category where category_id = ?`;

  const line = recordResult[0];

  const [primaryResult] = await pool.query(searchPrimaryGroupQs, [line.created_by]);
  if (primaryResult.length === 1) {
    const primaryGroupId = primaryResult[0].group_id;

    const [groupResult] = await pool.query(searchGroupQs, [primaryGroupId]);
    if (groupResult.length === 1) {
      recordInfo.createdByPrimaryGroupName = groupResult[0].name;
    }
  }

  const [appGroupResult] = await pool.query(searchGroupQs, [line.application_group]);
  if (appGroupResult.length === 1) {
    recordInfo.applicationGroupName = appGroupResult[0].name;
  }

  const [userResult] = await pool.query(searchUserQs, [line.created_by]);
  if (userResult.length === 1) {
    recordInfo.createdByName = userResult[0].name;
  }

  const [categoryResult] = await pool.query(searchCategoryQs, [line.category_id]);
  if (categoryResult.length === 1) {
    recordInfo.categoryName = categoryResult[0].name;
  }

  recordInfo.recordId = line.record_id;
  recordInfo.status = line.status;
  recordInfo.title = line.title;
  recordInfo.detail = line.detail;
  recordInfo.categoryId = line.category_id;
  recordInfo.applicationGroup = line.application_group;
  recordInfo.createdBy = line.created_by;
  recordInfo.createdAt = line.created_at;

  const searchItemQs = `select * from record_item_file where linked_record_id = ? order by item_id asc`;
  const [itemResult] = await pool.query(searchItemQs, [line.record_id]);
  // mylog('itemResult');
  // mylog(itemResult);

  const searchFileQs = `select * from file where file_id = ?`;
  for (let i = 0; i < itemResult.length; i++) {
    const item = itemResult[i];
    const [fileResult] = await pool.query(searchFileQs, [item.linked_file_id]);

    let fileName = '';
    if (fileResult.length !== 0) {
      fileName = fileResult[0].name;
    }

    recordInfo.files.push({ itemId: item.item_id, name: fileName });
  }

  await pool.query(
    `
	INSERT INTO record_last_access
	(record_id, user_id, access_time)
	VALUES
	(?, ?, now())
	ON DUPLICATE KEY UPDATE access_time = now()`,
    [`${recordId}`, `${user.user_id}`],
  );

  res.send(recordInfo);
};

/**
 * - record_status:
 *  - "open":   status が "open" であるrecordを取得する
 *  - "close":  status が "close" であるrecordを取得する
 * - limitation:    "tome" | "all" | "mine"
 */
const acquireRecords = async (req, res, record_status, limitation) => {
  // sprint(`start acquireRecords(${record_status}, ${limitation})`);
  const ts = [Date.now()];
  const cs = [""];
  // sprint("start getLinkedUser");
  let user = await getLinkedUser(req.headers);
  // sprint("end   getLinkedUser");
  ts.push(Date.now());
  cs.push("認証");

  if (!user) {
    res.status(401).send();
    return;
  }

  let offset = Number(req.query.offset);
  let limit = Number(req.query.limit);

  if (Number.isNaN(offset) || Number.isNaN(limit)) {
    offset = 0;
    limit = 10;
  }

  // sprint("start precondition");
  ts.push(Date.now());
  cs.push("offset-limit");
  const {
    searchRecordQsCore, searchRecordQsCoreParams,
  } = (() => {
    let searchRecordQsCore = `record where status = ?`;
    const searchRecordQsCoreParams = [record_status];

    ///////////////////////////////////////////////////////////////
    // record と user の関係性を考慮するセクション
    if (limitation === "mine") {
      searchRecordQsCore += ` and created_by = ?`;
      searchRecordQsCoreParams.push(user.user_id);
    } else if (limitation === "tome") {
      // - ユーザが所属するグループの一覧を取得し
      // - そのグループIDが上記一覧のいずれかを含む category_group を取得する
      searchRecordQsCore += ` and (category_id, application_group) in (
        SELECT
        category_id, application_group
        FROM
          category_group
        WHERE
          group_id
            IN
          (
            SELECT
              group_id
            FROM
              group_member
            WHERE
              user_id = ?
          )
      )`;
      searchRecordQsCoreParams.push(user.user_id);
    }
    ///////////////////////////////////////////////////////////////

    return {
      searchRecordQsCore, searchRecordQsCoreParams,
    };
  })();
  // sprint("end   precondition");
  ts.push(Date.now());
  cs.push("precond");
  const searchRecordQs = `
    select *
      from ${searchRecordQsCore}
      order by updated_at desc, record_id asc
      limit ? offset ?`;
  const searchRecordQsParams = [...searchRecordQsCoreParams, limit, offset];
  const recordCountQs = `select count(*) from ${searchRecordQsCore}`;
  const recordCountQsParams = searchRecordQsCoreParams;
  const countQueryPromise = pool.query(recordCountQs, recordCountQsParams)

  // sprint("start searchRecordQs");
  const [recordResult] = await pool.query(
    searchRecordQs, searchRecordQsParams
  );
  // sprint("end   searchRecordQs");

  ts.push(Date.now());
  cs.push("body");
  const items = Array(recordResult.length);
  let count = 0;
  const searchUserQs = 'select * from user where user_id = ?';
  const searchGroupQs = 'select * from group_info where group_id = ?';
  const searchThumbQs =
    'select * from record_item_file where linked_record_id = ? order by item_id asc limit 1';
  const countQs = 'select count(*) AS cnt from record_comment where linked_record_id = ?';
  const searchLastQs = 'select * from record_last_access where user_id = ? and record_id = ?';

  // - record
  //  - record_id
  //  - created_by
  //  - created_at
  //  - updated_at
  //  - application_group
  //  - title
  // - user
  //  - name
  // - group_info
  //  - name
  // - record_item_file
  //  - item_id
  // - record_comment
  //  - cnt
  //    - 既定値が0であることに注意
  // - record_last_access
  //  - access_time
  //  - 特殊:isUnConfirmed

  // record.created_by = user.user_id
  // record.application_group = group_info.group_id
  // record.record_id = record_item_file.linked_record_id
  // record.record_id = record_comment.linked_record_id
  // record.record_id = record_last_access.record_id
  // user.user_id = record_last_access.user_id

  
  

  // sprint(`start item_query(${recordResult.length})`);
  for (let i = 0; i < recordResult.length; i++) {
    const resObj = {
      recordId: null,
      title: '',
      applicationGroup: null,
      applicationGroupName: null,
      createdBy: null,
      createdByName: null,
      createAt: '',
      commentCount: 0,
      isUnConfirmed: true,
      thumbNailItemId: null,
      updatedAt: '',
    };

    const line = recordResult[i];
    const recordId = line.record_id;
    const createdBy = line.created_by;
    const applicationGroup = line.application_group;
    const updatedAt = line.updated_at;
    let createdByName = null;
    let applicationGroupName = null;
    let thumbNailItemId = null;
    let commentCount = 0;
    let isUnConfirmed = true;

    const [userResult] = await pool.query(searchUserQs, [createdBy]);
    if (userResult.length === 1) {
      createdByName = userResult[0].name;
    }

    const [groupResult] = await pool.query(searchGroupQs, [applicationGroup]);
    if (groupResult.length === 1) {
      applicationGroupName = groupResult[0].name;
    }

    const [itemResult] = await pool.query(searchThumbQs, [recordId]);
    if (itemResult.length === 1) {
      thumbNailItemId = itemResult[0].item_id;
    }

    const [countResult] = await pool.query(countQs, [recordId]);
    if (countResult.length === 1) {
      commentCount = countResult[0]['cnt'];
    }

    const [lastResult] = await pool.query(searchLastQs, [user.user_id, recordId]);
    if (lastResult.length === 1) {
      const updatedAtNum = Date.parse(updatedAt);
      const accessTimeNum = Date.parse(lastResult[0].access_time);
      if (updatedAtNum <= accessTimeNum) {
        isUnConfirmed = false;
      }
    }

    resObj.recordId = recordId;
    resObj.title = line.title;
    resObj.applicationGroup = applicationGroup;
    resObj.applicationGroupName = applicationGroupName;
    resObj.createdBy = createdBy;
    resObj.createdByName = createdByName;
    resObj.createAt = line.created_at;
    resObj.commentCount = commentCount;
    resObj.isUnConfirmed = isUnConfirmed;
    resObj.thumbNailItemId = thumbNailItemId;
    resObj.updatedAt = updatedAt;

    items[i] = resObj;
  }
  // sprint(`end   item_query(${recordResult.length})`);
  ts.push(Date.now());
  cs.push("aggre");

  const [recordCountResult] = await countQueryPromise;
  if (recordCountResult.length === 1) {
    count = recordCountResult[0]['count(*)'];
  }
  ts.push(Date.now());
  cs.push("count");

  const fname = `acquireRecords(${record_status}, ${limitation}) (${recordResult.length})`;
  for (let i = 1; i < ts.length; ++i) {
    console.log(`[${fname}:${i}] ${ts[i] - ts[i - 1]}ms\t${cs[i]}`);
  }
  // sprint(`end   acquireRecords(${record_status}, ${limitation})`);
  res.send({ count: count, items: items });
};


// PUT records/{recordId}
// 申請更新
const updateRecord = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;
  const status = req.body.status;

  await pool.query(`update record set status = ? where record_id = ?`, [
    `${status}`,
    `${recordId}`,
  ]);

  res.send({});
};

// GET records/{recordId}/comments
// コメントの取得
const getComments = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;
  const commentQs = `
    SELECT
      record_comment.created_by AS created_by,
      record_comment.comment_id AS comment_id,
      record_comment.created_at AS created_at,
      record_comment.value      AS value,
      group_info.name           AS group_name,
      user.name                 AS user_name
    FROM
      ((
        record_comment
          LEFT JOIN
        user
          ON
        record_comment.created_by = user.user_id
      )
          LEFT JOIN
        group_member
          ON
        user.user_id = group_member.user_id
          AND
        group_member.is_primary = true
      )
        LEFT JOIN
      group_info
        ON
      group_member.group_id = group_info.group_id
    WHERE
      linked_record_id = ?
    ORDER BY
      created_at desc
  `;
  // 使うデータ
  // - record_comment
  //   - created_by
  //   - created_at
  //   - comment_id
  //   - value
  // - group_member
  //   - 中間データのみ
  // - group_info
  //   - name
  // - user
  //   - name

  // `${recordId}` <- 謎の表現
  // const [commentResult] = await pool.query(commentQs, [`${recordId}`]);
  const [commentResult] = await pool.query(commentQs, [recordId]);

  const commentList = Array(commentResult.length);

  for (let i = 0; i < commentResult.length; i++) {
    let commentInfo = {
      commentId: '',
      value: '',
      createdBy: null,
      createdByName: null,
      createdByPrimaryGroupName: null,
      createdAt: null,
    };
    const line = commentResult[i];
    commentInfo.commentId = line["comment_id"];
    commentInfo.value     = line["value"];
    commentInfo.createdBy = line["created_by"];
    commentInfo.createdAt = line["created_at"];
    if (typeof line["group_name"] === "string") {
      commentInfo.createdByPrimaryGroupName = line["group_name"];
    }
    if (typeof line["user_name"] === "string") {
      commentInfo.createdByName = line["user_name"];
    }
    commentList[i] = commentInfo;
  }

  res.send({ items: commentList });
};

// POST records/{recordId}/comments
// コメントの投稿
const postComments = async (req, res) => {
  const ts = [Date.now()];
  const cs = [""];

  let user = await getLinkedUser(req.headers);

  ts.push(Date.now());
  cs.push("認証");

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;
  const value = req.body.value;

  await Promise.all([
    pool.query(
      `
      insert into record_comment
      (linked_record_id, value, created_by, created_at)
      values (?,?,?, now());`,
      [`${recordId}`, `${value}`, user.user_id],
    ),

    pool.query(
      `
      update record set updated_at = now() where record_id = ?;`,
      [`${recordId}`],
    ),
  ]);

  ts.push(Date.now());
  cs.push("insert2");
  const fname = `postComments (${recordId}, ${user.user_id})`;
  for (let i = 1; i < ts.length; ++i) {
    console.log(`[${fname}:${i}] ${ts[i] - ts[i - 1]}ms\t${cs[i]}`);
  }
  
  res.send({});
};


const categoryMaster = {};
const categoryList = [
  "緊急の対応が必要",
  "故障・不具合(大型)",
  "故障・不具合(中型・小型)",
  "異常の疑い(大型)",
  "異常の疑い(中型・小型)",
  "お客様からの問い合わせ",
  "オフィス外装・インフラ",
  "貸与品関連",
  "オフィス備品",
  "その他",
].map((name, i) => ({ name, category_id: i + 1 }));
for (let i = 0; i < categoryList.length; i++) {
  const { category_id, name } = categoryList[i];
  categoryMaster[category_id] = { name };
}

// GET categories/
// カテゴリーの取得
const getCategories = async (req, res) => {
  // sprint("start:  getLinkedUser");
  let user = await getLinkedUser(req.headers);
  // sprint("end:    getLinkedUser");

  if (!user) {
    res.status(401).send();
    return;
  }

  // マスターデータを返すだけっぽいので埋め込んでしまえばいいのでは？
  res.send({ items: categoryMaster });
};

// POST files/
// ファイルのアップロード
const postFiles = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const base64Data = req.body.data;
  // mylog(base64Data);
  const name = req.body.name;
  const newId = uuidv4();
  const newThumbId = uuidv4();
  const binary = Buffer.from(base64Data, 'base64');
  const image_path = `${filePath}${newId}_${name}`;
  const [dummy, image] = await Promise.all([
    writeFilePromise(image_path, binary),
    jimp.read(binary),
  ]);
  // mylog(image.bitmap.width);
  // mylog(image.bitmap.height);

  const size = image.bitmap.width < image.bitmap.height ? image.bitmap.width : image.bitmap.height;
  await image.cover(size, size);

  const thumb_path = `${filePath}${newThumbId}_thumb_${name}`;
  await image.writeAsync(thumb_path);

  await pool.query(`
    insert into file (file_id, path, name)
      values
        (?, ?, ?),
        (?, ?, ?)
    `,
    [
      newId, image_path, name,
      newThumbId, thumb_path, `thumb_${name}`,
    ],
  );

  res.send({ fileId: newId, thumbFileId: newThumbId });
};

// GET records/{recordId}/files/{itemId}
// 添付ファイルのダウンロード
const getRecordItemFile = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;
  const itemId = Number(req.params.itemId);

  const [rows] = await pool.query(
    `select f.name, f.path from record_item_file r
    inner join file f
    on
    r.linked_record_id = ?
    and
    r.item_id = ?
    and
    r.linked_file_id = f.file_id`,
    [`${recordId}`, `${itemId}`],
  );

  if (rows.length !== 1) {
    res.status(404).send({});
    return;
  }

  const fileInfo = rows[0];

  const data = await readFilePromise(fileInfo.path);
  const base64 = data.toString('base64');
  // mylog(base64);

  res.send({ data: base64, name: fileInfo.name });
};

// GET records/{recordId}/files/{itemId}/thumbnail
// 添付ファイルのサムネイルダウンロード
const getRecordItemFileThumbnail = async (req, res) => {
  let user = await getLinkedUser(req.headers);

  if (!user) {
    res.status(401).send();
    return;
  }

  const recordId = req.params.recordId;
  const itemId = Number(req.params.itemId);

  const [rows] = await pool.query(
    `select f.name, f.path from record_item_file r
    inner join file f
    on
    r.linked_record_id = ?
    and
    r.item_id = ?
    and
    r.linked_thumbnail_file_id = f.file_id`,
    [`${recordId}`, `${itemId}`],
  );

  if (rows.length !== 1) {
    res.status(404).send({});
    return;
  }

  const fileInfo = rows[0];

  const data = await readFilePromise(fileInfo.path);
  const base64 = data.toString('base64');
  // mylog(base64);

  res.send({ data: base64, name: fileInfo.name });
};

module.exports = {
  postRecords,
  getRecord,
  acquireRecords,
  updateRecord,
  getComments,
  postComments,
  getCategories,
  postFiles,
  getRecordItemFile,
  getRecordItemFileThumbnail,
};
