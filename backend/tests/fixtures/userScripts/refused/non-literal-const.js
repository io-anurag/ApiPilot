import http from "k6/http";
const k = "a";
const T = make();
const v = T[k];
export default function () { http.get(`${__ENV.BASE_URL}/`); }
