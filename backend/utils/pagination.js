const mongoose = require('mongoose');
const ApiError = require('./ApiError');

// Keyset (cursor) pagination that stays correct for any sort field.
// The cursor is opaque to clients: base64url of { v: <sort value>, id: <_id> } of the last item.
//
//   const page = await findPage(Product, filter, {
//     sort: { field: 'minPrice', dir: 1 },
//     cursor: req.validated.query.cursor,
//     limit: 20,
//     project: (q) => q.select('name minPrice'),
//   });
//   res.json({ success: true, ...page }); // -> { items, nextCursor }

function encodeCursor(doc, field) {
  const payload = { id: String(doc._id) };
  if (field !== '_id') payload.v = doc.get ? doc.get(field) : doc[field];
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(raw) {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!mongoose.isValidObjectId(parsed.id)) throw new Error('bad id');
    return { v: parsed.v, id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    throw new ApiError(422, 'INVALID_CURSOR', 'cursor is not valid');
  }
}

// Ties on the sort field are broken by _id in the same direction.
function sortSpec({ field, dir }) {
  return field === '_id' ? { _id: dir } : { [field]: dir, _id: dir };
}

function afterCursor(filter, { field, dir }, cursor) {
  if (!cursor) return filter;
  const op = dir === 1 ? '$gt' : '$lt';
  const cond =
    field === '_id'
      ? { _id: { [op]: cursor.id } }
      : { $or: [{ [field]: { [op]: cursor.v } }, { [field]: cursor.v, _id: { [op]: cursor.id } }] };
  return { $and: [filter, cond] };
}

async function findPage(Model, filter, { sort = { field: '_id', dir: -1 }, cursor, limit = 20, project } = {}) {
  const decoded = cursor ? decodeCursor(cursor) : null;

  let query = Model.find(afterCursor(filter, sort, decoded))
    .sort(sortSpec(sort))
    .limit(limit + 1);
  if (project) query = project(query);

  const docs = await query;
  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;

  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1], sort.field) : null,
  };
}

// Offset cursors, for lists whose order cannot be expressed as a keyset (e.g. sorted by distance).
// Still opaque to clients, so they page exactly like every other list.
function encodeOffsetCursor(offset) {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeOffsetCursor(raw) {
  try {
    const { o } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Number.isInteger(o) || o < 0) throw new Error('bad offset');
    return o;
  } catch {
    throw new ApiError(422, 'INVALID_CURSOR', 'cursor is not valid');
  }
}

module.exports = { findPage, encodeOffsetCursor, decodeOffsetCursor };
