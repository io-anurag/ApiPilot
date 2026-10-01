import http from "k6/http";
const x = make();
const p = x.__proto__;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
