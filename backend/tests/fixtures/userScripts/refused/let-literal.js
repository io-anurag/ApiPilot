import http from "k6/http";
const k = "a";
let T = {};
const v = T[k];
export default function () { http.get(`${__ENV.BASE_URL}/`); }
