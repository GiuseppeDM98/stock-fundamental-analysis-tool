## New Features

- Added company-specific smart scenario defaults — DCF scenarios are now auto-populated with real data from Yahoo Finance analyst estimates and historical financials instead of generic presets
- Added analyst estimates reference banner showing revenue growth, operating margins, target price, and number of analysts covering the stock
- Added scenario source indicator badge showing whether current scenarios come from Yahoo data ("Smart defaults"), generic presets ("Generic defaults"), or manual edits ("Custom")
- Scenario parameters are now displayed as percentages (e.g., 12%) instead of decimals (0.12)
- Added "Smart defaults" and "Generic defaults" reset buttons for quick scenario switching

## Bug Fixes

- Fixed historical charts showing year "1970" on X-axis — migrated from deprecated Yahoo Finance modules to `fundamentalsTimeSeries`
- Fixed Free Cash Flow always showing $0 in Revenue & FCF chart
- Fixed operating margin always showing 0% in Margins chart
- Fixed Y-axis displaying unreadable raw numbers (e.g., "000000") — now shows compact notation (391B, 108B)
- Fixed DCF valuations being too low due to reinvestment rate falling back to generic 30% instead of the company's actual rate (e.g., Apple's ~5%)

## Improvements

- Chart tooltips now show formatted values (compact numbers for revenue/FCF, percentages for margins)
- Removed "Enable compact charts" toggle that had no visible effect
