import http from "k6/http";
const x = make();
const c = x["constructor"];
export default function () { http.get(`${__ENV.BASE_URL}/`); }
