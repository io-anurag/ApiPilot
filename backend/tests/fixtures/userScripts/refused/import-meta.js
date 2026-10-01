import http from "k6/http";
const here = import.meta.url;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
