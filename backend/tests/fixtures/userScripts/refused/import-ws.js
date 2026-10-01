import ws from "k6/ws";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
