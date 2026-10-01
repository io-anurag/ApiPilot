import http from "k6/http";
const f = function () {};
const x = make();
x.__proto__ = f;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
