import sql from "k6/x/sql";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
