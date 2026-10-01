import http from "k6/http";
const k = "a";
const T = make();
T[k] += 1;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
