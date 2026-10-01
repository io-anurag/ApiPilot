import http from "k6/http";
const Function = 1;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
