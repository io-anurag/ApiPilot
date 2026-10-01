// AP-034 accepted fixture: a typical hand-written k6 script.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Gauge, Rate, Trend } from "k6/metrics";

export const options = {
  vus: 2,
  duration: "10s",
  thresholds: {
    http_req_duration: ["p(95)<500"],
  },
};

const orderLatency = new Trend("order_latency");
const ordersCreated = new Counter("orders_created");
const orderErrors = new Rate("order_errors");
const queueDepth = new Gauge("queue_depth");

export default function () {
  const base = __ENV.BASE_URL;
  const params = { headers: { "X-Api-Key": __ENV.API_KEY }, tags: { name: "GET /orders" } };
  group("orders", function () {
    const list = http.get(`${base}/orders`, params);
    check(list, { "list is 200": (r) => r.status === 200 });
    const created = http.post(`${base}/orders`, JSON.stringify({ item: "book" }), {
      headers: { "Content-Type": "application/json", "X-Api-Key": __ENV.API_KEY },
      tags: { name: "POST /orders" },
    });
    orderLatency.add(created.timings.duration);
    ordersCreated.add(1);
    orderErrors.add(created.status !== 201);
    queueDepth.add(3);
    http.del(`${base}/orders/1`, null, { tags: { name: "DELETE /orders/{id}" } });
  });
  sleep(1);
}
