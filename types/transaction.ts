/** شكل طلبات `/api/transactions` — متطابق مع `server/store` */
export type ServerTransaction = {
  id: string;
  order_ref: string;
  client_id: string;
  type: "buy" | "sell";
  amount: number;
  method: string;
  status: string;
  created_at: string;
  details?: string | null;
  agent_number_id?: string | null;
};
