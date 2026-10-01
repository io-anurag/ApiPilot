import secrets from "k6/secrets";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
