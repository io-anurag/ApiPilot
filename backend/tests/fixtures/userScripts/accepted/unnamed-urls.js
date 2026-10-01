// AP-034 accepted fixture: unnamed requests with ids, user info and queries in their URLs.
import http from "k6/http";

const FIXED = "https://api.example.test:8443/x";

export default function () {
  console.log(__ENV.API_KEY);
  for (let id = 0; id < 130; id++) {
    http.get(`${__ENV.BASE_URL}/customers/${id}?token=abc&page=${id}`);
  }
  http.get(FIXED);
}
