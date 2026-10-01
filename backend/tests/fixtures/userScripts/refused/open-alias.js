import http from "k6/http";
const o = open;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
