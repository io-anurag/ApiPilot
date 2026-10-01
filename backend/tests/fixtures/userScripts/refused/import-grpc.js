import grpc from "k6/net/grpc";
export default function () { http.get(`${__ENV.BASE_URL}/`); }
