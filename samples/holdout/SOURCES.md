# Holdout set sources

These are held-out freight documents for the extraction eval. Text PDFs were extracted with `pdftotext -layout`. Scans and
images went through `tesseract 5.5.4` with the tessdata_fast models, after rendering with `pdftoppm` at the dpi
noted per document. The text is left exactly as extracted, OCR noise included; nothing was corrected. Where
noted, I tried a few tesseract page-segmentation modes and kept one whole output unedited. Labels come only
from what each document visibly states. I checked them against the page image, not the OCR text.

**OCR losses are deliberate but mean some labels can't be recovered from the text.** The affected docs are 09
(port of loading) and 10 (total amount); 03 keeps its total only as words. Each case is called out below.
Drop those fields if you only want to score extraction, not OCR robustness.

## Port codes

I checked port codes against the UN/LOCODE code list, using UNECE data as mirrored at
https://github.com/datasets/un-locode (`data/code-list.csv`). The UNECE site itself blocks scripted access with Cloudflare.

| Code  | Code-list entry | Used in    |
| ----- | --------------- | ---------- |
| BRPNG | Paranaguá       | 09         |
| ESBIO | Bilbao          | 07         |
| GBFXT | Felixstowe      | 08         |
| KRPUS | Busan           | 02         |
| MXATM | Altamira        | 08         |
| MXVER | Veracruz        | 06, 09     |
| NLRTM | Rotterdam       | 01, 03, 04 |
| PECLL | Callao          | 07         |
| SGSIN | Singapore       | 05         |
| USLGB | Long Beach      | 10         |

**Chinese ports were left unlabelled because the codes are ambiguous.** The current list has several
candidate entries for each port:

| Port     | Candidates                                                               |
| -------- | ------------------------------------------------------------------------ |
| Shanghai | CNSGH "Shanghai" (functions 12345), CNSHG "Shanghai Pt"                  |
| Ningbo   | CNNBO "Ningbo", CNNBG "Ningbo Pt", CNBLG "Beilun Pt"                     |
| Xiamen   | CNXAM "Xiamen", CNXMG "Xiamen Pt"                                        |
| Xingang  | CNTXG "Tianjin Xingang Pt", CNXGA "Xingang" (Guangdong), CNTNJ "Tianjin" |

The codes the trade still uses (CNSHA, CNNGB, CNXMN) are now listed as the _airports_. So `portOfLoading` is
omitted in 01 (Ningbo), 04 (Xiamen) and 10 (Xingang). If you want them scored, add an alias set per port
and accept any member.

## Documents

### 01-oocl-delivery-order-ningbo-rotterdam (English, text PDF)

- Source: https://github.com/sensible-hq/sensible-configuration-library/blob/main/templates/Logistics/Delivery%20Orders/refdocs/oocl_sample.pdf
- What: an OOCL delivery order for Ningbo to Rotterdam on vessel THALASSA AVRA. It is a real carrier layout; the publisher redacted the parties and the B/L number.
- Licence: MIT (Sensible open-source configuration library).
- Judgement calls:
  - documentType is `other`, because a delivery order is none of the listed types.
  - The form has no shipper field, and the consignee box is empty (redacted). Both are null.
  - departureDate is "DEPARTURE Mar 14 2023".
  - arrivalDate is "ETA Apr 29 2023", the vessel ETA at the port of discharge. I did not use "ESTIMATED CARGO ARRIVAL DATE May 01 2023", which is for the place of delivery.
  - portOfLoading is omitted because Ningbo is ambiguous (see above).
  - There are no amounts, so total is null.

### 02-comesys-invoice-busan-netherlands (English, text PDF)

- Source: https://github.com/sensible-hq/sensible-configuration-library/blob/main/templates/Logistics/Commercial%20Invoices/refdocs/ai_generalized_commercial_invoice_sample_2.pdf
- What: a commercial invoice from a Korean exporter (ComeSys Ltd., auto parts), EX-WORK. The publisher partially redacted it.
- Licence: MIT (same repository).
- Judgement calls:
  - "Leaving: Busan, Korea" is the port of loading. "Arriving: Netherlands" names only a country, so portOfDischarge is null.
  - departureDate is "Shipdate: 3rd May, 2023".
  - The consignee block is absent ("BUYER: Same as Consignee"), so consignee is null.
  - "300 EA" is a piece count, not packages, so packages is null. No weights are given.

### 03-incap-invoice-scan-india-rotterdam (English, scanned image PDF, OCR at 300 dpi)

- Source: https://github.com/sensible-hq/sensible-configuration-library/blob/main/templates/Logistics/Commercial%20Invoices/refdocs/ai_generalized_commercial_invoice_sample.pdf
- What: an Indian export invoice from Incap Contract Manufacturing Services (EHTP unit), with black-box redactions.
- Licence: MIT (same repository).
- Judgement calls:
  - The exporter box is redacted. The shipper comes from the "InCap" logo and the signature block "For INCAP CONTRACT MANUFACTURING SERVICES PVT LTD", labelled as the core name "Incap".
  - The consignee is redacted, so it is null.
  - portOfLoading is omitted. The document says "ICD BANGALORE", an inland container depot. The code list has INBLR (Bangalore, with the remark "ICD/CFS = WFD"), but there is no INWFD entry, and INWFT is a Whitefield SEZ. No single code is unambiguous.
  - departureDate is null. The only dates are the invoice date 12.04.2023 and the LUT date.
  - grossWeightKg and netWeightKg are omitted. The invoice says "Net wt: 8,759 / Gross wt: 9,263" with no unit.
  - total is "Total:: 114,942.00" USD. **The OCR dropped the numeric total line.** The amount survives only in words: "US DOLLAR ONE HUNDRED FOURTEEN THOUSAND NINE HUNDRED FORTY-TWO".

### 04-zhangzhou-invoice-scan-xiamen-rotterdam (English + Chinese, scanned image PDF, OCR eng+chi_sim at 300 dpi)

- Source: https://github.com/sensible-hq/sensible-configuration-library/blob/main/templates/Logistics/Commercial%20Invoices/refdocs/ai_generalized_commercial_invoice_sample_3.pdf
- What: a commercial invoice from a Chinese exporter (Zhangzhou Weiping Import & Export Trade Co., plants), with redactions.
- Licence: MIT (same repository).
- Judgement calls:
  - "FROM XIAMEN,CHINA TO ROTTERDAM,HOLLAND" gives the route. Rotterdam is labelled. Xiamen is omitted as ambiguous (see above).
  - The invoice number and date, terms and consignee ("Messrs") are redacted. Dates and consignee are null.
  - packages is 8 ("8 WOODEN CASES"); "1*40RH" is the container count, not packages. No weights are given. total is 13,737.000 USD.

### 05-lta-annotated-sample-bl-singapore (English, scan with annotations, OCR at 144 ppi native)

- Source: https://onemotoring.lta.gov.sg/content/dam/onemotoring/Selling%20%26%20Deregistering/pdf/SampleBL(label).pdf
- What: a sample bill of lading from Singapore Land Transport Authority guidance for exporting a car (fictional "EXCELLENT SHIPPING CO."). The scan has red and blue callouts and a "SAMPLE" watermark over it, so it is deliberately messy.
- Licence: Singapore Government website content. Used here only as an eval fixture.
- Judgement calls:
  - Port of discharge "Hampton" and place of delivery "Yellowstone, UK" are fictional, so portOfDischarge is omitted.
  - departureDate comes from "SHIPPED ON BOARD ON: 03/08/2018". I read it as DD/MM (Singapore convention), giving 2018-08-03. A US reader could take it as 8 March.
  - packages is 1 ("1CTNR", "1UNITS"). Gross weight is 1,258.0000 KGS.
  - There is no freight amount ("FREIGHT AS ARRANGED", "XXX"), so total is null.

### 06-mercurio-factura-comercial-scan-es (Spanish, poor scan, OCR spa at 300 dpi)

- Source: https://ru.dgb.unam.mx/bitstream/20.500.14330/TES01000304742/3/0304742.pdf, page 111 ("Anexo No. 3 Factura comercial"), a UNAM thesis on letters of credit.
- What: a Mexican commercial invoice. Exportadora e Importadora Mercurio S.A. de C.V. bills Tornillos y Similares Jama, S.A. (San José, Costa Rica). Invoice no. 0110, dated September 2, 1997.
- Licence: none stated; a public university thesis repository. Internal eval use only.
- Judgement calls:
  - The "FACTURADO A" party is labelled as the consignee.
  - Port of loading comes from "EMBARQUE VIA MARITIMA PUERTO DE VERACRUZ". No discharge port is given, so portOfDischarge is null.
  - The only date is the invoice date, so departureDate is null.
  - The whole `cargo` object is omitted. "UNA TONELADA DE TORNILLO..." is a goods quantity in the description, not a stated gross or net weight. "NUMEROS: 1 AL 100" is a marks range, not an explicit package count.
  - total is "TOTAL US. 10,000.00" ("DIEZ MIL DOLARES 00/100 USCY"). The OCR garbles the figure but keeps the words.

### 07-savino-del-bene-cotizacion-flete-es (Spanish, low-res embedded image, OCR spa at 600 dpi grayscale, psm 4)

- Source: https://docta.ucm.es/bitstreams/4cae5d6d-14b2-41c9-bf93-1183f689cabd/download, page 33 ("Anexo X"), a student export project at Universidad Complutense de Madrid.
- What: a freight quotation from Savino Del Bene S.L. (Madrid) for Bilbao to Callao. It itemises ocean freight, BUF, Panama canal fee, security, THC at destination in USD, and Spanish local charges.
- Licence: none stated; a university repository. It may be a student-built example on the forwarder's letterhead. Internal eval use only.
- Judgement calls:
  - I used psm 4 at 600 dpi because the default OCR run lost the "FLETES EXPORTACION BILBAO (ES) - CALLAO (PE)" heading completely. The output is still unedited.
  - shipper is omitted. The quote is addressed to "IBERICAN INTERSUPPLIER S.L.", but the document never says that firm is the shipper. No consignee is named, so consignee is null.
  - total is null. The quote lists line items in EUR plus one in USD ($95 THC destination) but states no grand total. A model that sums the lines should be marked wrong.
  - There are no dates and no cargo details.

### 08-magna-charter-bl-scan-felixstowe-altamira (English, scan, OCR eng at 300 dpi)

- Source: https://ru.dgb.unam.mx/bitstream/20.500.14330/TES01000842981/3/0842981.pdf, page 74 ("Anexo 1. Bill of Lading"), a UNAM thesis about a customs agency.
- What: a real Magna Charter Line bill of lading. Permastore UK Ltd ships to Aqua del Guadiana SA de CV (Durango) on MSD MEDITERRANEAN/87A, Felixstowe to Altamira.
- Licence: none stated; a public thesis repository. Company data only. Internal eval use only.
- Judgement calls:
  - departureDate comes from "SHIPPED ON BOARD DATE 11-Dec-2008", which matches the issue date.
  - The whole `cargo` object is omitted. Packages are stated as "1 20 FOOT OPEN TOP CONTAINER STC 4 WOODEN CASES 1 BUNDLE", so the count could be 1 or 5. The weights (gross 10150.00, net 9420.00, tare 2513.00) carry no unit.
  - Freight is collect with no amount, so total is null.

### 09-greif-invoice-scan-paranagua-veracruz (English form with Spanish item text, scan, OCR eng at 300 dpi, psm 6)

- Source: same UNAM thesis as 08, page 86 ("Anexo 11. Factura Comercial").
- What: a real Brazilian export commercial invoice. Greif Embalagens Ind. do Brasil Ltda (Tri-Sure closures) bills Van Leer Mexicana S.A. de CV. Invoice Exp 209/08-AR, dated 22/08/08.
- Licence: as for 08.
- Judgement calls:
  - I kept psm 6 because the default psm 3 run lost the "TOTAL FOB 95.850,05" line. The output is unedited.
  - **"Port of Shipment: Paranagua - PR - Brazil" is unreadable in every OCR run I tried, so BRPNG can't be recovered from the text.** Port of delivery "Vera Cruz - Mexico" survives.
  - Weights use the Brazilian decimal comma: "Total Net Weight: 16.416,640 Kgs" and "Total Gross Weight: 17.783,230 Kgs", giving 16416.64 and 17783.23 kg. The OCR reads the net as "16.496,640", which is within the 1% tolerance. It renders the gross as "17,783,230".
  - total is "TOTAL FOB 95.850,05" with "(ALL CURRENCY IN USD)". The line items sum to this amount.
  - The only date is the invoice date, so departureDate is null. No package count is given.

### 10-arrival-notice-invoice-redacted-long-beach (English, low-res JPEG with grey redactions and a red hand-drawn circle, upscaled 3x, OCR eng psm 3)

- Source: https://fresatechnologies.com/wp-content/uploads/2020/04/Cargo-arrival-notice.pdf, page 4 (embedded JPEG). It is a forwarder's "ARRIVAL NOTICE / INVOICE" used in a vendor explainer, with vessel MSC CANDICE / 526N, Xingang to Long Beach.
- Licence: none stated; vendor marketing content. Internal eval use only.
- Judgement calls:
  - documentType is omitted. The page is titled "ARRIVAL NOTICE / INVOICE" and carries an invoice number and due date, so `invoice` and `other` are both defensible.
  - shipper is omitted because it is partly redacted ("QING[...]TRY CO.,LTD"). The consignee is fully redacted, so it is null.
  - portOfLoading is omitted (Xingang is ambiguous, see above).
  - Dates come from "ETD : 06/24/2015" and "ETA AT PORT : 07/11/2015", both MM/DD with a US forwarder.
  - packages is 10, from "10 PKG(S)" on the house B/L line. No weights are given.
  - total is "TOTAL USD 55.00" (import handling charge). **The default OCR run lost the amount**, which sits inside the red circle. A psm 6 run misread it as "65,00", so I kept the default run.

## Considered and dropped

- Mindee client-lib test-data bill of lading (`v1/products/bill_of_lading/default_sample.jpg`). It is fictional, and once the ambiguous Shanghai code, the contradictory package count (1 CTN vs 2 PLTS) and the unclear "USD: 31.57" were omitted, too few fields were left.
- ecustomsclearing.com arrival notices. The parties are cropped, and the OCR lost the ports and weights.
- Many blank carrier and customs templates (Maersk, Hapag-Lloyd, JSE, FedEx/DHL/UPS, MSBDC) were skipped because they are not filled in.

## Changes after labelling (before any held-out run)

- Dropped `portOfLoading` from 09 and `total`/`totalUsd` from 10: OCR destroyed those values, so they test the OCR, not the extractor.
- The app schema was changed to allow null shipper, consignee and ports, because these real documents (redacted parties, country-only destinations) showed the original schema forced the model to invent them.
