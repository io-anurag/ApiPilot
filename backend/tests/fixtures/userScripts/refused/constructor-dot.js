import http from "k6/http";
const c = (() => 1).constructor;
export default function () { http.get(`${__ENV.BASE_URL}/`); }
