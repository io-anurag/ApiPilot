import http from "k6/http";
const x = ;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
