# Traps in 01-santos-hamburg-coffee.txt

Answer key: 01-santos-hamburg-coffee.expected.json. All values are the final ones after the 14/03 correction.

| # | Trap | Correct value and source |
|---|------|--------------------------|
| 1 | Port of loading changed in amendment (quoted 11/03 says Paranagua BRPNG) | BRSSZ. "POL = SANTOS (BRSSZ). Paranagua was wrong." |
| 2 | Port of discharge changed (quoted says Bremerhaven DEBRV) | DEHAM. "POD = HAMBURG (DEHAM). Bremerhaven is OUT." |
| 3 | Place of receipt is inland, not a port (Uberlandia ICD) | Not used. "Uberlandia ICD is place of receipt only (inland)" |
| 4 | Transshipment port (Algeciras ESALG) and inland final destination (Munich) are not POL/POD | Not used. Header "Transshipment: Algeciras (ESALG)", "Final destination: Munich, DE" |
| 5 | Consignee name: old trade name "Roasters" in notify/quoted text | "Hanseatic Roastery GmbH" (correction line and invoice header). Suffix GmbH dropped. |
| 6 | Notify party is a distractor | Zephyr Coffee Imports LLC, not used. Header "Notify:" |
| 7 | Freight forwarder/sender is a distractor | Andina Logistik S.A. (signature and header), not used as shipper |
| 8 | Shipper name with suffix | "Cerrado Café Exportadora Ltda" -> "Cerrado Café Exportadora" |
| 9 | ETD amended from 12/03/2026 to Thursday 19/03/2026 | 2026-03-19. "ETD now Thursday 19/03/2026 (was 12/03...)" and header "ETD (corrected): 19-Mar-26". Mixed DD/MM/YYYY and DD-Mon-YY. 19 Mar 2026 is a Thursday. |
| 10 | Arrival not given; only transit time (old 31 days superseded by 28) | 2026-04-16 = 2026-03-19 + 28 days. Old "ETA 15-Apr-26" is superseded. |
| 11 | Relative dates: "next Tuesday", "Tuesday 17/03" | Not needed for the answer. "next Tuesday (10/03)" is from the 9 Mar email and is superseded. |
| 12 | Packages changed from 1.200 (quoted) to 1.260 | 1260. "Packages: 1.260 bags, 20 kg net each" and "C/NO 1-1260". Pt-BR thousands dot. |
| 13 | Net weight in three formats: "25.200 kg" (quoted), "25,2 t", "25.2OO,OO KG" (OCR) | 25200 kg. Dot is thousands in pt-BR. 25,2 t = 25200 kg. OCR "25.2OO,OO" = 25200. |
| 14 | Gross weight: superseded 60.380 lb (about 27388 kg, near miss), OCR "27.38S KG" | 27385 kg. "Gross 27.385 kg (warehouse already confirmed)". OCR S = 5. |
| 15 | VGM distractor (27.910 kg incl. pallets) | Not used. "The VGM ... 27.910 kg ... NOT the gross cargo weight" |
| 16 | OCR noise: I.26O, 0/O swaps, C0FFEE | Packages 1260 is restated in the clean correction line and the C/NO marks. |
| 17 | Grand total in EUR, but mixed-currency charge table | EUR 1385.00. Table: "GRAND TOTAL (EUR lines only)". EUR lines 85 + 240 + 1180 = 1505, minus credit note 120 = 1385. |
| 18 | USD and BRL lines are billed direct, not in the total | Excluded. "The USD and BRL lines are billed by Meridian directly and are NOT in that total." Subtotal USD 3160 is "NOT payable to Andina". |
| 19 | Credit note as negative line | -120.00 EUR (CN-0457). Old total 1410 superseded. |
| 20 | Number formats: 1.234,56 (pt/de) mixed with 1,234.56 | Used throughout pt/de style. Only figures the key needs are noted above. |
| 21 | Languages: EN, PT, ES, DE, with German disclaimer and PT notes | Key facts are in English lines. |
| 22 | totalUsd conversion | 1385.00 EUR x 1.09 = 1509.65 USD |
| 23 | Invoice date DD/MM/YYYY (04/03/2026), email date with weekday | documentType "invoice". Not needed for key fields. |
