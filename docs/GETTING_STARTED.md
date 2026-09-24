# Getting started, one step at a time

_The same steps as [OPERATIONS.md](OPERATIONS.md), written so that nothing is assumed. Do them in order.
Each step says what to do, why, and how you know it worked. Nothing risks money until step 9._

## Part 1 — get the robot onto GitHub

**Step 1. Give your Mac a GitHub key that is allowed to upload workflows.**
Why: the robot's schedule lives in files GitHub treats as special, and the key your Mac already has is
not allowed to upload them.
How: on github.com, Settings → Developer settings → Personal access tokens → Fine-grained tokens →
Generate. Name it "AiFi_Executor". Only this one repository. Permissions: Contents = Read and write,
Workflows = Read and write. Copy the token once; you will paste it in step 2 and never see it again.
Done when: you have the token copied.

**Step 2. Upload the robot.**
How: open Terminal and run the two lines below. The second line will ask for a username (your GitHub
name) and a password: paste the token as the password.
```bash
git credential-osxkeychain erase <<< $'protocol=https\nhost=github.com\n'
cd ~/AiFi_Executor && git push -u origin main
```
Done when: github.com/SproutHouse/AiFi_Executor shows the files and an "Actions" tab with four workflows:
cycle, approve, control, review.

**Step 3. Give the robot a way to talk to you.**
Why: it runs on GitHub's computers, which have no way to reach your phone unless you give them one.
How: install the free ntfy app on your phone. Invent a long random topic name, for example
`exec-` followed by twelve random letters. In the app, subscribe to that topic. On GitHub: repository →
Settings → Secrets and variables → Actions → New repository secret. Name `ALERT_WEBHOOK`, value
`https://ntfy.sh/` followed by your topic. Never use your name in the topic.
Done when: the secret shows in the list.

**Step 4. Wake it up once by hand.**
How: repository → Actions → cycle → Run workflow → Run.
Done when: the run shows a green check, and a new commit named "Cycle …" appears with files under `state/`.
If no alert arrives at this point that is normal; alerts only fire when something happens.

**Step 5. Let it practise for a few days.**
Why: it is now trading pretend money, six times a day. This is how you learn what its messages look like
before real money is involved.
What you will see: a push when it enters or exits, and one summary line each morning. It does not ask you
anything: tier A signals execute on their own, tier B signals are written down and skipped.
`state/ledger/LEDGER.md` on GitHub is its notebook; `state/ledger/refused.jsonl` lists what it skipped and why.
Done when: you have seen at least one entry and one refusal and you understand both.

## Part 2 — the wallet (real money, small)

**Step 6. Read Hyperliquid's terms, section 1.5.**
Why: it names who may not use the platform. You need to be comfortable before funding anything.
Done when: you have read it.

**Step 7. Make a brand-new wallet just for the robot.**
Why: this wallet is the robot's whole world. Whatever is in it is all it can ever touch.
How: a hardware wallet is best. If not, a new wallet whose secret phrase you write on paper and never type
into any computer that runs the robot.
Done when: the wallet exists and holds nothing yet.

**Step 8. Put in a small test amount, then the pot.**
How: send a few dollars of USDC on Arbitrum to the wallet first, connect it at app.hyperliquid.xyz and
deposit; Hyperliquid needs at least 5 USDC to open the account. When that worked, send the real pot. The
pot should be an amount you could lose completely and shrug: about 5% of your portfolio is the default.
Done when: the Hyperliquid account shows the pot as balance.

**Step 9. Give the robot its own key that cannot take money out.**
Why: Hyperliquid lets the wallet's owner create a second key, an "API wallet" or agent, that may place and
cancel orders but may never withdraw or move funds. That is the only key the robot ever gets.
How: in the Hyperliquid app, API → generate an API wallet, name it "executor", approve it with your main
wallet, and copy the agent's private key and your main wallet's public address. Check that the address shown
on the signing screen is the agent's.
Done when: you hold the agent private key and the main wallet address.

**Step 10. Prove the key is the right kind.**
How: in Terminal, in `~/AiFi_Executor`, export the two values for that window only, then run
`pip install -r requirements-live.txt` and `python3 scripts/verify_keys.py --probe-order`.
Done when: it prints the agent address, confirms it differs from your main address, reads the balance, places
an order far below the market that cannot fill, cancels it, and ends with OK. If it says the key is the
MASTER key, stop: you copied the wrong key.

**Step 11. Give the key to GitHub.**
How: repository → Settings → Secrets → two new secrets: `HL_AGENT_KEY` (the agent private key) and
`HL_ACCOUNT_ADDRESS` (your main wallet address).
Done when: three secrets are listed: ALERT_WEBHOOK, HL_AGENT_KEY, HL_ACCOUNT_ADDRESS.

**Step 12. Switch from pretend to real.**
How: Actions → control → Run workflow → flatten (closes any pretend positions). Then edit
`config/settings.json` on GitHub, change `"mode": "paper"` to `"mode": "live"`, commit.
Done when: the next cycle's log says `mode live` and the line `reconciliation` is not a mismatch.

**Step 13. Watch the first week.**
What to look for: the first entry alert, the stop order appearing on the exchange (Hyperliquid's app shows
it under open orders), exits arriving on their own, and the Sunday review. Keep the pot small until thirty
real trades have happened.

## Part 2b — the dashboard, ten minutes

**Step 13b. Give GitHub the Cloudflare keys.** Three repository secrets: `CLOUDFLARE_API_TOKEN` (the AiFi
one works if it may edit Workers and KV), `CLOUDFLARE_ACCOUNT_ID`, and a new `DASHBOARD_PASSWORD` you invent.
Then Actions → deploy-dashboard → Run workflow. The log of the deploy step prints the page's address.
Done when: the address opens, asks for the password, and shows the Overview with the last cycle.

## Part 3 — move the robot to a server in Europe

**Step 14. Open an Oracle Cloud account.** cloud.oracle.com, Always Free. Choose the home region carefully,
it cannot be changed later: Frankfurt, Amsterdam or Zurich. Oracle asks for a card and identity checks;
nothing is charged inside the free limits.

**Step 15. Create the small computer.** Compute → Instances → Create. Image Ubuntu 24.04, shape
VM.Standard.A1.Flex, 1 OCPU, 6 GB. Add your SSH public key. If it says out of capacity, try again later or
pick another shape. Note the public IP. Afterwards, upgrade the account to Pay As You Go so Oracle does not
reclaim the machine for being idle; it stays free within the limits.

**Step 16. Get a registration token.** GitHub → the repository → Settings → Actions → Runners → New
self-hosted runner → Linux. Copy the token shown in the `./config.sh` line. It lasts one hour.

**Step 17. Run the setup script on the server.** `ssh ubuntu@<the IP>`, then paste the one line from
OPERATIONS.md with your token at the end. Done when GitHub's Runners page shows `executor-eu` as Idle.

**Step 18. Flip the switch.** GitHub → Settings → Secrets and variables → Actions → Variables → New
repository variable: name `RUNNER_LABEL`, value `self-hosted`. From the next cycle the robot runs from
Europe. Done when the next cycle's log shows the runner name `executor-eu`.

## If anything feels wrong

Actions → control → Run workflow → `halt` stops new trades; `flatten` closes everything now. From the
Hyperliquid app, revoking the agent key stops the robot completely. Any of these takes under a minute.
