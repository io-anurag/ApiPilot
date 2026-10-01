import http from "k6/http";
const f = function () {};
const T = { __proto__: f };
export default function () { http.get(`${__ENV.BASE_URL}/`); }
