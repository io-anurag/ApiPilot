import http from "k6/http";
const fn = Function("return 1");
export default function () { http.get(`${__ENV.BASE_URL}/`); }
