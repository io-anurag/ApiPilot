import http from "k6/http";
const key = "a";
const x = make();
const v = x[key];
export default function () { http.get(`${__ENV.BASE_URL}/`); }
