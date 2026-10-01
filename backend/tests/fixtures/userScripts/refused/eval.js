import http from "k6/http";
const one = eval("1");
export default function () { http.get(`${__ENV.BASE_URL}/`); }
