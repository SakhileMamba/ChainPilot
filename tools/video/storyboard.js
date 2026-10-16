// The video tutorial, scene by scene. Each scene has:
//   id        names its voice file: video/voice/<id>.wav (or .mp3/.m4a) if you record your own
//   chapter   for the chapter list on the website
//   say       the narration, written to be spoken (numbers in words where it matters)
//   text      the caption, if it should differ from `say` (e.g. digits)
//   run(d, x) what happens on screen; d is the Director, x the context (URLs, product)
// Scenes last as long as their narration (or their actions, if longer).
import { card, chainScene, edgeScene, installScene, oddsScene, phoneScene } from './scenes.js';

export const CHAPTERS = ['Install', 'First start', 'Your plan', 'How compounding works', 'Subscribe with MoMo', 'Playing a session', 'Staying in control'];

/** A short chapter card over the start of a chapter's first scene. */
async function chapterIntro(d, x, n, title) {
  await d.unspot();
  await d.chapter(`${n} · ${title}`);
  await d.card(card({ icon: x.icon, kicker: `Chapter ${n}`, title }));
  await d.wait(1500);
  await d.card(null);
}

const field = (name) => `label.field:has(input[name=${name}])`;

export const STORYBOARD = [
  // ---------------- welcome ----------------
  {
    id: '01-welcome',
    chapter: 'Welcome',
    say: `Welcome to ChainPilot. In this video you'll see how to install it, set up your plan, subscribe with MTN MoMo, and run a session. You'll also see exactly how the compounding strategy works, and what it can't do.`,
    async run(d) {
      // the welcome card is already showing (set up before recording starts)
    },
  },

  // ---------------- install ----------------
  {
    id: '02-download',
    chapter: 'Install',
    say: `Start on the ChainPilot website. Open the download page and get the installer. You need Windows 10 or 11, and Google Chrome or Microsoft Edge, which comes with Windows.`,
    async run(d, x) {
      await chapterIntro(d, x, 1, 'Install');
      await d.cue('Open the download page');
      await d.spot('.download-card', { title: 'Download', body: 'Free for Windows 10 and 11.' });
      await d.cue('You need');
      await d.spot('main section ul', { title: 'What you need', body: 'Chrome or Edge, and your casino account.' });
    },
  },
  {
    id: '03-smartscreen',
    chapter: 'Install',
    say: `Because the installer is new, Windows may say it protected your PC. Click More info, then Run anyway. ChainPilot installs for your Windows account only, so it doesn't need administrator rights.`,
    async run(d, x) {
      await d.unspot();
      await d.stage(installScene(x.installerName));
      await d.step(1);
      await d.cue('Windows may say');
      await d.step(2);
      await d.cue('ChainPilot installs');
      await d.step(3);
    },
  },
  {
    id: '04-open',
    chapter: 'Install',
    say: `When setup finishes, open ChainPilot from the Start menu. The control panel opens in its own window, and a small log window starts minimised. Keep it open while ChainPilot runs.`,
    async run(d) {
      await d.step(4);
    },
  },

  // ---------------- first start ----------------
  {
    id: '05-notice',
    chapter: 'First start',
    say: `The first time, ChainPilot asks you to confirm that you are eighteen or older, and that you understand what it does. It doesn't predict rounds, and it doesn't change the odds. On average, every bet loses about three percent.`,
    text: `The first time, ChainPilot asks you to confirm that you are 18 or older, and that you understand what it does. It doesn't predict rounds, and it doesn't change the odds. On average, every bet loses about 3%.`,
    async run(d, x) {
      await d.goto(x.appUrl);
      await d.locator('#welcome[open]').waitFor();
      await chapterIntro(d, x, 2, 'First start');
      await d.spot('#welcome ul', { title: 'Read this first', body: 'No predictions, no better odds. Only bet what you can afford to lose.', side: 'right' });
    },
  },
  {
    id: '06-accept',
    chapter: 'First start',
    say: `Accept, and you're in. There are four tabs: Play, How compounding works, Subscription, and Help. The badge on the right shows whether you're subscribed.`,
    async run(d) {
      await d.unspot();
      await d.click('#accept');
      await d.cue('four tabs');
      await d.spot('.tabs', { title: 'Four tabs', body: 'Play, the strategy explained, your subscription, and help.' });
      await d.cue('The badge');
      await d.spot('#license-chip', { title: 'Free version', body: 'Simulator, dry run and practice cost nothing.', side: 'below' });
    },
  },

  // ---------------- your plan ----------------
  {
    id: '07-modes',
    chapter: 'Your plan',
    say: `Your plan lives on the Play tab. First, choose a mode. A dry run watches real rounds and bets on paper. Practice clicks for real, on the game's play money. Both are free. Live uses real money, and needs a subscription.`,
    async run(d, x) {
      await chapterIntro(d, x, 3, 'Your plan');
      await d.spot('.modes', { title: 'Mode' });
      await d.cue('A dry run');
      await d.spot('label.mode:has(input[value="dry-run"])', { title: 'Dry run', body: 'Real rounds, paper bets. Free.' });
      await d.cue('Practice clicks');
      await d.spot('label.mode:has(input[value="practice"])', { title: 'Practice', body: "Real clicks on the game's play money. Free." });
      await d.cue('Live uses');
      await d.spot('label.mode:has(input[value="live"])', { title: 'Live', body: 'Real money. Needs a subscription.' });
    },
  },
  {
    id: '08-bet',
    chapter: 'Your plan',
    say: `The initial bet is what every chain starts with. If a chain is lost, this is exactly what it costs. We'll use ten.`,
    async run(d) {
      await d.spot(field('bet'), { title: 'Initial bet', body: 'A lost chain costs exactly this.' });
      await d.cue("We'll use ten");
      await d.type('input[name=bet]', '10');
    },
  },
  {
    id: '09-cashout',
    chapter: 'Your plan',
    say: `Cash out at is your multiplier. ChainPilot turns on the game's own Auto Cash Out, so the game's server takes the win at exactly this point. There's no click delay.`,
    async run(d) {
      await d.spot(field('cashout'), { title: 'Cash out at 1.90×', body: "The game's server cashes out at exactly this multiplier." });
    },
  },
  {
    id: '10-steps',
    chapter: 'Your plan',
    say: `Wins per chain is where compounding happens. After each win, the whole payout rides on the next round, until this many wins in a row complete the chain.`,
    async run(d) {
      await d.spot(field('steps'), { title: 'Wins per chain', body: "Each win's whole payout is bet again. Five wins in a row complete the chain." });
    },
  },
  {
    id: '11-limits',
    chapter: 'Your plan',
    say: `Then come your limits. Stop after ends the session when you've completed this many chains. The loss limit stops the session before its loss could pass this amount. Set it to money you can afford to lose. We'll use one hundred. And the time limit ends the session after the minutes you choose.`,
    async run(d) {
      await d.spot(field('chains'), { title: 'Stop after', body: 'End the session after this many completed chains.' });
      await d.cue('The loss limit');
      await d.spot(field('maxLoss'), { title: 'Loss limit', body: 'The most this session can lose. Only money you can afford.' });
      await d.cue("We'll use one hundred");
      await d.type('input[name=maxLoss]', '100');
      await d.cue('the time limit');
      await d.spot(field('maxMinutes'), { title: 'Time limit', body: 'The session ends after this many minutes.' });
    },
  },
  {
    id: '12-gap',
    chapter: 'Your plan',
    say: `Rounds between bets waits a random number of rounds after each bet. It spreads your bets out over time. It doesn't change the odds.`,
    async run(d) {
      await d.spot(field('maxGap'), { title: 'Rounds between bets', body: "Spreads bets out. Doesn't change the odds." });
    },
  },
  {
    id: '13-glance',
    chapter: 'Your plan',
    say: `As you type, This plan at a glance shows what your settings mean: what a full chain pays, how likely it is, and the average return. With these settings, a full chain turns ten into two hundred and forty seven, but only about one chain in twenty nine gets there.`,
    text: `As you type, "This plan at a glance" shows what your settings mean: what a full chain pays, how likely it is, and the average return. With these settings, a full chain turns 10 into 247.60, but only about 1 chain in 29 gets there.`,
    async run(d) {
      await d.spot('#glance', { title: 'This plan at a glance', body: 'Updates as you type.' });
    },
  },

  // ---------------- how compounding works ----------------
  {
    id: '14-chain',
    chapter: 'How compounding works',
    say: `Here's the idea. You bet ten, cashing out at one point nine times. A win pays nineteen, and all of it rides on the next round. Then thirty six, sixty eight, one hundred and thirty. Five wins in a row turn ten into two hundred and forty seven.`,
    text: `Here's the idea. You bet 10, cashing out at 1.90×. A win pays 19, and all of it rides on the next round. Then 36.10, 68.59, 130.32. Five wins in a row turn 10 into 247.60.`,
    async run(d, x) {
      await chapterIntro(d, x, 4, 'How compounding works');
      await d.stage(chainScene());
      await d.step(1);
      await d.cue('A win pays');
      await d.step(2);
      await d.cue('Then thirty six');
      await d.step(3);
      await d.cue('sixty eight');
      await d.step(4);
      await d.cue('one hundred and thirty');
      await d.step(5);
      await d.cue('Five wins');
      await d.step(6);
    },
  },
  {
    id: '15-loss',
    chapter: 'How compounding works',
    say: `But one loss anywhere ends the chain. You lose your ten, because everything above it was the chain's own winnings. Then a new chain starts again from ten.`,
    async run(d) {
      await d.step(7);
    },
  },
  {
    id: '16-odds',
    chapter: 'How compounding works',
    say: `The catch is that the chance shrinks as fast as the stake grows. At one point nine times, one bet wins about fifty one percent of the time. Each step needs another win, so five in a row happen only about three and a half percent of the time. That's roughly one chain in twenty nine.`,
    text: `The catch is that the chance shrinks as fast as the stake grows. At 1.90×, one bet wins about 51% of the time. Each step needs another win, so five in a row happen only about 3.5% of the time. That's roughly 1 chain in 29.`,
    async run(d) {
      await d.stage(oddsScene());
      await d.step(1);
      await d.cue('one bet wins');
      await d.step(2);
      await d.cue('Each step');
      for (let n = 3; n <= 5; n++) {
        await d.step(n);
        await d.wait(700);
      }
      await d.cue('five in a row');
      await d.step(6);
    },
  },
  {
    id: '17-edge',
    chapter: 'How compounding works',
    say: `And the house edge compounds too. On average the game returns ninety seven percent of what's bet. A five step chain is five bets riding on each other, so it returns about eighty six percent of its first bet. Compounding makes the rare wins bigger. It doesn't change which way the average points.`,
    text: `And the house edge compounds too. On average the game returns 97% of what's bet. A five-step chain is five bets riding on each other, so it returns about 86% of its first bet. Compounding makes the rare wins bigger. It doesn't change which way the average points.`,
    async run(d) {
      await d.stage(edgeScene());
      await d.cue('On average');
      await d.step(1);
      await d.cue('A five step chain');
      for (let n = 2; n <= 5; n++) {
        await d.step(n);
        await d.wait(450);
      }
      await d.cue('so it returns');
      await d.step(6);
    },
  },
  {
    id: '18-explainer',
    chapter: 'How compounding works',
    say: `You can check all of this with your own numbers, on the How compounding works tab. The story at the top describes your chain, and the tiles show the key odds.`,
    async run(d) {
      await d.stage(null);
      await d.click('#tab-strategy');
      await d.cue('The story');
      await d.spot('.ex-story', { title: 'Your chain, in words' });
      await d.cue('the tiles');
      await d.spot('#explainer .tiles', { title: 'The key odds', body: 'For the settings above.' });
    },
  },
  {
    id: '19-ladder',
    chapter: 'How compounding works',
    say: `The ladder shows every step: what you bet, what it pays if it wins, and the chance that the chain gets that far.`,
    async run(d) {
      await d.spot('.ladder', { title: 'Step by step', body: 'The chance roughly halves at every step.', side: 'above' });
    },
  },
  {
    id: '20-change',
    chapter: 'How compounding works',
    say: `Try a lower multiplier, and fewer steps. Chains now complete far more often, but they pay much less. The average return per bet doesn't change.`,
    async run(d) {
      await d.unspot();
      await d.type('#explainer input[name=cashout]', '1.5');
      await d.type('#explainer input[name=steps]', '3');
      await d.wait(700);
      await d.spot('#explainer .tiles', { title: 'Same game, different shape', body: 'More frequent, smaller wins.', side: 'below' });
    },
  },
  {
    id: '21-sim',
    chapter: 'How compounding works',
    say: `Back on our original plan, ChainPilot simulates four thousand sessions below. Most sessions end down, usually at the loss limit, and some reach the goal. That's the honest shape of this strategy.`,
    text: `Back on our original plan, ChainPilot simulates 4,000 sessions below. Most sessions end down, usually at the loss limit, and some reach the goal. That's the honest shape of this strategy.`,
    async run(d) {
      await d.unspot();
      await d.type('#explainer input[name=cashout]', '1.9');
      await d.type('#explainer input[name=steps]', '5');
      await d.wait(1500); // the simulation re-runs
      await d.spot('#explainer .tiles >> nth=1', { title: '4,000 simulated sessions', side: 'above' });
      await d.cue('Most sessions');
      await d.spot('.ex-chart', { title: 'How sessions end', body: 'Red: ended down. Blue: ended up.', side: 'above' });
      await d.unspot();
      await d.hover('.chart .bar');
    },
  },
  {
    id: '22-use',
    chapter: 'How compounding works',
    say: `When you're happy with a plan, press Use these settings, to copy it to the Play tab.`,
    async run(d) {
      await d.click('#explainer .ex-controls .btn');
      await d.wait(500);
      await d.spot(field('cashout'), { title: 'Copied to your plan' });
    },
  },

  // ---------------- subscribe ----------------
  {
    id: '23-sub-machine',
    chapter: 'Subscribe with MoMo',
    say: `Live betting needs a subscription. Open the Subscription tab. This is your computer's machine ID. Your subscription belongs to this PC.`,
    async run(d, x) {
      await chapterIntro(d, x, 5, 'Subscribe with MoMo');
      await d.click('#tab-subscription');
      await d.cue('This is your');
      await d.spot('.machine', { title: 'Machine ID', body: 'Your subscription works on this computer. Quote it if you contact support.' });
    },
  },
  {
    id: '24-sub-plan',
    chapter: 'Subscribe with MoMo',
    say: `Choose a plan, then enter your MTN MoMo number.`,
    async run(d) {
      await d.unspot();
      await d.check('#plans input[value=month]');
      await d.type('#subscribe-form input[name=phone]', '7612 3456');
    },
  },
  {
    id: '25-sub-pay',
    chapter: 'Subscribe with MoMo',
    say: `Press Pay with MoMo. A payment prompt arrives on your phone. Check the amount, and approve it with your MoMo PIN.`,
    async run(d, x) {
      await d.click('#pay');
      await d.locator('#order:not([hidden])').waitFor();
      await d.spot('#order', { title: 'Waiting for approval', body: 'The app checks with MoMo every few seconds.' });
      await d.cue('A payment prompt');
      await d.unspot();
      await d.stage(phoneScene({ amount: x.monthPrice, currency: x.currency, product: x.name, plan: '1 month' }));
      await d.step(1);
      await d.cue('approve it');
      for (let n = 2; n <= 5; n++) {
        await d.step(n);
        await d.wait(350);
      }
      await d.step(6);
    },
  },
  {
    id: '26-sub-done',
    chapter: 'Subscribe with MoMo',
    say: `As soon as MoMo confirms, ChainPilot activates by itself. If you renew early, the new days are added to the end of your subscription.`,
    async run(d) {
      await d.stage(null);
      await d.page.waitForFunction(() => document.querySelector('#license-chip')?.textContent.startsWith('Subscribed'), null, { timeout: 30_000 });
      await d.spot('#order', { title: 'Payment received' });
      await d.cue('If you renew');
      await d.spot('#license-card', { title: 'Subscribed', body: 'Renewing early adds the days on top.' });
    },
  },
  {
    id: '27-restore',
    chapter: 'Subscribe with MoMo',
    say: `Reinstalled Windows, or closed the app before the payment confirmed? Press Restore purchase. You can also paste a license key here.`,
    async run(d) {
      await d.spot('.card:has(#restore)', { title: 'Already paid?', body: 'Restore purchase finds your subscription.' });
    },
  },

  // ---------------- playing ----------------
  {
    id: '28-open-game',
    chapter: 'Playing a session',
    say: `Back on the Play tab, open the game window, and log in to the casino there. ChainPilot remembers your login. Keep that window open and visible while it plays.`,
    async run(d, x) {
      await chapterIntro(d, x, 6, 'Playing a session');
      await d.click('#tab-play');
      await d.spot('#open-game', { title: 'Game window', body: 'Log in once; the login is remembered.' });
      await d.cue('ChainPilot remembers');
      await d.unspot();
      await d.click('#open-game');
    },
  },
  {
    id: '29-start',
    chapter: 'Playing a session',
    say: `Let's start a dry run. In this video, the rounds are simulated. In real use, ChainPilot plays in the game window, with the game's own Auto Cash Out.`,
    async run(d) {
      await d.check('input[name=mode][value="dry-run"]');
      await d.cue('In this video');
      await d.badge('SIMULATED ROUNDS FOR THIS VIDEO');
      await d.click('#start');
    },
  },
  {
    id: '30-watch',
    chapter: 'Playing a session',
    say: `The session panel shows the running total, how many bets won, completed chains, and the next bet. Every bet is listed below, and saved to a spreadsheet you can open later.`,
    async run(d) {
      await d.spot('.session', { title: 'Session', body: 'Running total, wins, chains and the next bet.', side: 'below' });
      await d.cue('Every bet');
      await d.spot('.card:has(#bets)', { title: 'Every bet', body: 'Also saved to a spreadsheet file.', side: 'left' });
    },
  },
  {
    id: '31-stop',
    chapter: 'Playing a session',
    say: `Press Stop at any time. A bet that's already in the air is allowed to settle first. For live betting, ChainPilot asks you to confirm before it bets real money.`,
    async run(d) {
      await d.unspot();
      if (await d.visible('#stop')) await d.click('#stop');
      await d.wait(1200);
      await d.badge(null);
      await d.spot('.session', { title: 'Stopped', body: 'The session ends cleanly.', side: 'below' });
    },
  },

  // ---------------- staying in control ----------------
  {
    id: '32-help',
    chapter: 'Staying in control',
    say: `The Help tab has a quick guide, links to support services, your bet logs, and a check for updates. Fixes for the game page download automatically when ChainPilot starts.`,
    async run(d, x) {
      await chapterIntro(d, x, 7, 'Staying in control');
      await d.click('#tab-help');
      await d.spot('#panel-help .prose', { title: 'Quick guide' });
      await d.cue('links to support');
      await d.spot('.card:has(#helplines)', { title: 'Support services', side: 'left' });
      await d.cue('check for updates');
      await d.spot('.card:has(#about)', { title: 'Updates', body: 'Game-page fixes arrive automatically.', side: 'left' });
    },
  },
  {
    id: '33-control',
    chapter: 'Staying in control',
    say: `Before every session, set a loss limit you can afford to lose, and a time limit. Never raise your limit to chase losses. If gambling stops being fun, take a break, and talk to someone.`,
    async run(d) {
      await d.spot('.card:has(#helplines)', { title: 'Play responsibly', body: 'Limits first. Never chase losses.', side: 'left' });
    },
  },
  {
    id: '34-outro',
    chapter: 'Staying in control',
    say: `That's ChainPilot. Download it for free, try the simulator, a dry run and practice mode, and subscribe with MoMo when you're ready. Thanks for watching, and play responsibly.`,
    async run(d, x) {
      await d.unspot();
      await d.chapter(null);
      await d.hideCursor();
      await d.card(
        card({
          icon: x.icon,
          kicker: x.siteHost ?? 'Download from our website',
          title: `${x.name}: your plan, played exactly`,
          sub: 'Free: simulator, dry run and practice. Subscribe with MTN MoMo when you are ready. 18+ only. Play responsibly.',
        }),
      );
    },
  },
];
