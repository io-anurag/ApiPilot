// AP-034 accepted fixture: index forms research R3 rule 4 accepts.
import http from "k6/http";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

const users = new SharedArray("users", function () {
  return [{ name: "a" }, { name: "b" }, { name: "c" }];
});
const data = [1, 2, 3];

export default function () {
  for (let i = 0; i < data.length; i++) {
    http.get(`${__ENV.BASE_URL}/items/${data[i]}`);
  }
  const random = data[Math.floor(Math.random() * data.length)];
  const user = users[(__VU - 1) % users.length];
  const other = data[exec.vu.idInTest % 3];
  const truncated = data[__ITER | 0];
  const name = "BASE_URL";
  const fromEnv = __ENV[name];
  http.get(`${fromEnv}/users/${user.name}/${random}/${other}/${truncated}`);
}
