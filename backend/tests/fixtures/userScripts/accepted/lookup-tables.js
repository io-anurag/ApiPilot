// AP-034 accepted fixture: research R3 rule 4's literal-base and computed-write allowances.
import http from "k6/http";

const STATUS = { ok: 200, created: 201 };
const LIST = ["a", "b"];

export default function () {
  const key = "ok";
  const expected = STATUS[key];
  const second = LIST[key];
  const headers = {};
  const name = "X-Trace";
  headers[name] = "1";
  const nested = { inner: {} };
  nested.inner[name] = "2";
  const counts = new Map();
  counts.set(key, 1);
  const seen = counts.get(key);
  const owned = Object.prototype.hasOwnProperty.call(STATUS, key);
  const hasOwn = Object.hasOwn(STATUS, key);
  const res = http.get(`${__ENV.BASE_URL}/x`, { headers: headers });
  if (res.status !== expected || !owned || !hasOwn || !seen || second === "x") console.log("mismatch");
}
