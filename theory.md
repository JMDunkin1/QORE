# Theory

QORE is the Quantitative Operations Runtime Engine for turning this weather and natural gas thesis into local data, model, backtest, and execution-readiness work.

## Basic observation from last winter

Forecasts of below normal air temperatures in the central and eastern US (eastern ⅔ of CONUS) trigger sharp rises in the price of united states natural gas prises of the UNG etf

In the 7-10 day forecast period, confidence in and arctic blast would have to be large enough to trigger an a rise in UNG prices

UNG would sell of following the event or right before in the 1-3 day forecast window in a buy the rumor sell the news type of trade

I would like to double check the sell off window in backtesting

## API's

For future weather:

Open meteo Weather forecast API

Will call temperature (2m)

For past forecasts (to backtest)

Open Meteo's Historical forecast API

Will call temperature (2m)

## Models to be used

ECMWF IFS .25degree

ECMWF AIFS

NCEP GFS Global .11/.25

NCEP HGEFS 0.25° Ensemble Mean

NCEP AIGFS .25

GEM Global

Of course, to make a prediction of anomalies, we will need average temperatures too which should be easy enough to find

In addition, because it is the eastern ⅔ of CONUS we will be looking at, we will need to run through many locations to make sure it is a trend

If we have to vibecast thats fine too

Essential their are 2 steps to this project

Build the arctic blast finder to delineate when cold air is coming

Build the trading algorithm based on past trends when an arctic outbreak is forecast
