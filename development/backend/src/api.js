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
  // mylog(target);
  const qs = `select linked_user_id from session where value = ? limit 2`;
  const [rows] = await pool.query(qs, [target]);
  if (rows.length !== 1) {
    // mylog('セッションが見つかりませんでした。');
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
  await Promise.all([
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

  const combinedQs = `
      SELECT
      record.record_id          AS record_id,
      record.status             AS status,
      record.title              AS title,
      record.detail             AS detail,
      record.category_id        AS category_id,
      record.application_group  AS application_group,
      record.created_by         AS created_by,
      record.created_at         AS created_at,
      min(primary_group.name)   AS primary_group_name,
      min(app_group.name)       AS app_group_name,
      min(user.name)            AS user_name,
      min(category.name)        AS cat_name,
      GROUP_CONCAT(
        record_item_file.item_id ORDER BY record_item_file.item_id ASC SEPARATOR '/'
      )
                                AS item_ids,
      GROUP_CONCAT(
        file.name ORDER BY record_item_file.item_id ASC SEPARATOR '/'
      )
                                AS file_names
    FROM
      record

      LEFT JOIN
      group_member
        ON
      (record.created_by = group_member.user_id AND group_member.is_primary = true)

      LEFT JOIN
      user
        ON
      record.created_by = user.user_id

      LEFT JOIN
      group_info as primary_group
        ON
      group_member.group_id = primary_group.group_id

      LEFT JOIN
      group_info as app_group
        ON
      record.application_group = app_group.group_id

      LEFT JOIN
      category
        ON
      record.category_id = category.category_id

      LEFT JOIN
      record_item_file
        ON
      record_item_file.linked_record_id = record.record_id

      LEFT JOIN
      file
        ON
      file.file_id = record_item_file.linked_file_id
    WHERE
      record_id = ?
    GROUP BY
      record.record_id
    ;
  `
  const combinedParams = [recordId];

  const [combinedResult] = await pool.query(combinedQs, combinedParams);

  if (combinedResult.length !== 1) {
    res.status(404).send({});
    return;
  }


  const result = combinedResult[0];
  let recordInfo = {
    recordId: result.record_id,
    status: result.status,
    title: result.title,
    detail: result.detail,
    categoryId: result.category_id,
    categoryName: result.cat_name,
    applicationGroup: result.application_group,
    applicationGroupName: result.app_group_name,
    createdBy: result.created_by,
    createdByName: result.user_name,
    createdByPrimaryGroupName: result.primary_group_name,
    createdAt: result.created_at,
    files: [],
  };

  const item_ids = result.item_ids.split("/");
  const file_names = result.file_names.split("/");
  item_ids.forEach((itemId, i) => {
    const name = file_names[i];
    recordInfo.files.push({ itemId: parseInt(itemId, 10), name });
  })

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
  ts.push(Date.now());
  cs.push("precond");
  const searchRecordQsParams = [...searchRecordQsCoreParams, limit, offset];
  const recordCountQs = `select count(*) from ${searchRecordQsCore}`;
  const recordCountQsParams = searchRecordQsCoreParams;
  const countQueryPromise = pool.query(recordCountQs, recordCountQsParams)

  const combinedQueryQs = `

  SELECT
  record.record_id            AS record_id,
  record.created_by           AS created_by,
  record.created_at           AS created_at,
  record.updated_at           AS updated_at,
  record.application_group    AS application_group,
  record.title                AS title,
  min(user.name)              AS user_name,
  min(group_info.name)        AS group_name,
  min(record_item_file.item_id)
                              AS thumb_item_id,
  min(record_last_access.access_time)
                              AS access_time,
  count(distinct record_comment.comment_id)
                              AS comment_cnt
FROM
  (select * from ${searchRecordQsCore} order by updated_at desc, record_id asc limit ? offset ?) AS record

  LEFT JOIN
  user
  ON
  record.created_by = user.user_id

  LEFT JOIN
  group_info
  ON
  record.application_group = group_info.group_id

  LEFT JOIN
  record_last_access
  ON
  (record.record_id = record_last_access.record_id
      AND
  user.user_id = record_last_access.user_id)

  LEFT JOIN
  record_item_file
  ON
  record.record_id = record_item_file.linked_record_id

  LEFT JOIN
  record_comment
  ON
  record.record_id = record_comment.linked_record_id

GROUP BY
  record.record_id

ORDER BY
  record.updated_at DESC, record.record_id ASC
;

  `;

  const [combinedResult] = await pool.query(
    combinedQueryQs, searchRecordQsParams
  );

  ts.push(Date.now());
  cs.push("body");
  const items = Array(combinedResult.length);
  let count = 0;

  for (let i = 0; i < combinedResult.length; i++) {
    const line = combinedResult[i];
    const recordId = line.record_id;
    const createdBy = line.created_by;
    const applicationGroup = line.application_group;
    const updatedAt = line.updated_at;

    const resObj = {
      recordId,
      title: line.title,
      applicationGroup,
      applicationGroupName: null,
      createdBy,
      createdByName: null,
      createAt: line.created_at,
      commentCount: 0,
      isUnConfirmed: true,
      thumbNailItemId: null,
      updatedAt,
    };

    let createdByName = line.user_name;
    let applicationGroupName = line.group_name;
    let thumbNailItemId = line.thumb_item_id;
    let commentCount = line.comment_cnt;
    let isUnConfirmed = true;

    const access_time = line.access_time;
    if (access_time) {
      const updatedAtNum = Date.parse(updatedAt);
      const accessTimeNum = Date.parse(access_time);
      if (updatedAtNum <= accessTimeNum) {
        isUnConfirmed = false;
      }
    }

    resObj.applicationGroupName = applicationGroupName;
    resObj.createdByName = createdByName;
    resObj.commentCount = commentCount;
    resObj.isUnConfirmed = isUnConfirmed;
    resObj.thumbNailItemId = thumbNailItemId;

    items[i] = resObj;
  }

  ts.push(Date.now());
  cs.push("aggre");

  const [recordCountResult] = await countQueryPromise;
  if (recordCountResult.length === 1) {
    count = recordCountResult[0]['count(*)'];
  }
  ts.push(Date.now());
  cs.push("count");

  const fname = `acquireRecords(${record_status}, ${limitation}) (${combinedResult.length})`;
  for (let i = 1; i < ts.length; ++i) {
    console.log(`[${fname}:${i}] ${ts[i] - ts[i - 1]}ms\t${cs[i]}`);
  }

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

  let user = await getLinkedUser(req.headers);

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
