import http from "k6/http";
const secret = open("/etc/passwd");
export default function () { http.get(`${__ENV.BASE_URL}/`); }
