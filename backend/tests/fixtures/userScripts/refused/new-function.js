import http from "k6/http";
const fn = new Function();
export default function () { http.get(`${__ENV.BASE_URL}/`); }
