import http from "k6/http";
const f = function () {};
const p = Object.getPrototypeOf(f);
export default function () { http.get(`${__ENV.BASE_URL}/`); }
