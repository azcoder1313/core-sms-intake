# CORE SMS Intake — Ag Equity

SMS intake handler for CORE Product farmer lead capture.

## Endpoints

- `POST /sms` — GHL inbound SMS webhook
- `POST /missed-call` — GHL missed call webhook  
- `GET /health` — health check

## Environment Variables

| Var | Default | Description |
|---|---|---|
| GHL_TOKEN | (hardcoded) | GHL API token |
| LOCATION_ID | NcJddt6h22VLqrHhSygt | GHL location |
| AARON_PHONE | +14159090825 | Aaron's cell for alerts |
| TIM_PHONE | +15102992955 | Tim's cell for alerts |
| PRIMARY_NUM | +15598447093 | Primary outbound number |
| PORT | 3000 | Server port |

## Flow

1. Farmer scans postcard QR → texts CORE to (559) 844-7093
2. GHL fires webhook to `/sms`
3. Handler sends opening message with A/B/C options
4. Conversation managed via in-memory state
5. On completion: GHL contact updated + Tim & Aaron notified
