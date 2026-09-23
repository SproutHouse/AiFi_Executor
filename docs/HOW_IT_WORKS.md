# How it works, in plain English

_The reference for the rules themselves is [LOGIC.md](LOGIC.md). This page is the version you read
before coffee._

## What it is

A small program that runs six times a day, five minutes after each 4-hour candle closes. Each time, for a
short list of large, liquid coins, it asks three questions and acts on the answers:

1. **Is the tide in?** The pair's weekly Momentum Cloud must be bullish, judged on the last completed
   week. If not, the bot does nothing in that pair and sits in USDC. There is no "bear setting" that
   shorts: shorting lost money in every test we ran.
2. **Is the trend intact today?** The pair's daily Momentum Cloud must also be bullish.
3. **Did a trigger just fire?** Either the 4-hour Momentum Cloud flipped bullish on the bar that just
   closed, or price pulled back into the 4-hour Noodle band from above while the 4-hour cloud stayed
   bullish.

If all three are yes, it works out a position size from one number, how far away the stop is, so that
losing the trade costs about 1% of the pot. Then, depending on the hour, it either asks you or acts.

## Your hours

- **10:00 to 22:00 in Toronto time:** every entry becomes a proposal. You get a push notification with
  the coin, the stop, the size as a percentage of the pot, and an id. You approve from your phone through
  GitHub, or you ignore it and it expires when the next 4-hour candle closes.
- **22:00 to 10:00:** tier A signals execute by themselves. Tier A means a 4-hour flip while the pair's
  daily and weekly are bullish and Bitcoin's weekly is bullish too. Pullbacks and anything less aligned
  still wait for you.
- **Exits never wait.** A stop, a 4-hour or daily flip against, or a weekly flip closes the position at
  the next cycle, day or night.

## How the money is protected

- The pot on Hyperliquid is a fresh wallet holding only what the bot may trade. Your other holdings are
  elsewhere and the bot cannot reach them.
- The program holds an **agent key**. It can place and cancel orders. It cannot withdraw or move funds.
  The master key that could is kept offline and is never in this repository or on GitHub.
- Every position has a stop **on the exchange itself**, a reduce-only order that triggers on the mark
  price. If GitHub is down, or this program crashes, the exchange still closes the trade at the stop.
- Caps: 1% of the pot at risk per trade, 4% at risk across all open trades, leverage never above 3x,
  never more than 6 positions. If the pot is down 10% from its peak, risk per trade halves. Down 20%, it
  stops opening trades until you look.
- Before any entry it checks that its data is fresh, that the run started on time, that Hyperliquid's
  price agrees with Binance's, and, in live mode, that its own book matches the exchange's. Any failure
  refuses the entry and writes down why.

## What you will see

- A push for each proposal, each entry, each exit, and any problem. Once a day, a one-line summary.
  Amounts are always percentages of the pot, never dollars.
- `state/ledger/LEDGER.md`, regenerated every cycle: open positions, closed trades with their result in R,
  and how many signals were refused.
- A Sunday review in `state/review/`, with hit rate, average R, costs per trade, and the gates for going
  live or changing a rule. It proposes; it never changes anything by itself.

## What R means

R is the amount you decided to risk on a trade. A trade that loses exactly its stop is minus 1 R. A trade
that makes twice what it risked is plus 2 R. Measuring in R makes trades of different sizes comparable and
is the only honest way to read a trend-following record, where most trades lose a little and a few win a
lot. Expect win rates around 30 to 40 percent, and losing streaks of ten or more. That is normal for this
kind of system and is why the caps exist.

## What it will never do

Short. Use leverage above 3x. Trade a coin you have not put on the allowlist. Trade a young or thin market.
Change its own parameters. Hold the master key. Put dollar amounts in a notification. Move forward from a
failed check.

## How to stop it

From your phone: GitHub, Actions, **control**, choose `halt` (no new entries) or `flatten` (close
everything now and halt). From the exchange: revoke the agent key from the master wallet. Either works in
under a minute.
