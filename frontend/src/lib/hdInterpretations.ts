// Human Design interpretation data — enriched, open-source-friendly paraphrases
// Source material: Chetan Parkyn, "Human Design: Discover the Person You Were Born to Be" (2009)
// All descriptions are original paraphrases, not reproduced text.

export interface TypeData {
  title: string
  overview: string
  strategy: string
  strategy_explained: string
  energy_pattern: string
  alignment_signs: string
  misalignment_signs: string
  practical_guidance: string
  signature: string
  not_self: string
  pct: string
  color: string
}

export interface ChannelData {
  name: string
  centers: [string, string]
  keywords: string[]
  description: string
}

export interface CenterData {
  defined_short: string
  undefined_short: string
  defined_detail: string
  undefined_detail: string
  color: string
}

export interface ProfileData {
  name: string
  description: string
}

// ── Types ────────────────────────────────────────────────────────────────────

export const HD_TYPES: Record<string, TypeData> = {
  Generator: {
    title: 'Generator',
    overview: 'You are built for sustained, renewable life-force energy — the backbone of the world\'s workforce, making up roughly a third of all people. Your Sacral center gives you access to a consistent inner motor that others simply do not have. When you are engaged with work and relationships that genuinely call to you, this energy is remarkable: it replenishes itself through use rather than depleting. The challenge is learning the difference between conditioned action — doing what feels expected or urgent — and genuine response, the gut signal that tells you something is truly for you. Without that distinction, you can pour enormous energy into the wrong things and wonder why you feel so tired and empty.',
    strategy: 'Wait to respond',
    strategy_explained: 'Your energy is not designed to launch things from scratch but to build powerfully once something in your environment calls to you. Response is not passive — it is highly specific. Your body knows before your mind does. The gut says uh-huh or uh-uh, and that signal is your compass. When you wait for a genuine response and then commit from that place, your energy builds and sustains. When you initiate from mental pressure or social expectation, the same energy drains and frustrates. Life works best when you let opportunities seek you out — and they will.',
    energy_pattern: 'Consistent, motor-like energy designed to run for a long time when pointed in the right direction. When misaligned, it turns grinding and produces mounting frustration. When in flow, the work itself feels satisfying — not because of the outcome but because the doing is alive. Others can feel this energy when you are engaged; it has a magnetic, sustaining quality.',
    alignment_signs: 'Deep satisfaction — even in difficult work. A feeling that what you are doing fits and matters. Energy that replenishes rather than depletes by the end of the day.',
    misalignment_signs: 'Frustration that builds slowly and doesn\'t resolve. A sense of running hard but going nowhere. Staying committed to projects, roles, or people that no longer carry any inner yes.',
    practical_guidance: 'Train yourself to recognize the genuine gut response. Ask yes/no questions and notice the physical reaction before the mind has time to analyze. The right commitments feel alive in the body; the wrong ones feel flat, even if they look reasonable on paper. Small daily responses are more reliable than dramatic decisions — and patience, rather than impatience, is what allows the right things to find you.',
    signature: 'Satisfaction',
    not_self: 'Frustration',
    pct: '37%',
    color: '#22c55e',
  },
  'Manifesting Generator': {
    title: 'Manifesting Generator',
    overview: 'You carry the raw life-force of the Generator with something extra: a direct energetic connection between your Sacral center and the Throat. This creates an intensely fast, multi-directional nature that can skip steps others need to take. You are designed to move efficiently, change direction without apology, and accomplish more in less time than almost any other type. The paradox is that your speed can work against you — moving before checking the gut response creates friction and chaos that slows you down far more than patience would have.',
    strategy: 'Wait to respond, then inform',
    strategy_explained: 'Like Generators, you are designed to respond rather than initiate. But once the gut says yes, you can move fast — and you are allowed to skip steps and find shortcuts. The informing piece matters: when you let the people around you know what you are doing and where you are headed — especially when you change direction — you reduce the resistance that naturally builds around your initiating energy. This is not asking permission. It is a courtesy that keeps your path clear and your relationships intact.',
    energy_pattern: 'Fast, multi-directional energy that thrives on efficiency and can juggle multiple things simultaneously. When engaged correctly, your output is impressive and your momentum infectious. When misaligned, the same speed produces scattered projects, unfinished commitments, and a kind of frustration that feels like spinning your wheels at high speed.',
    alignment_signs: 'Excited satisfaction — things clicking into place quickly. The ability to pursue several things at once without losing quality. A sense of forward momentum that feels energizing rather than depleting.',
    misalignment_signs: 'Frustration when forced to move at someone else\'s slower pace. Anger when others cannot keep up with your shifts in direction. A trail of abandoned projects that started with genuine enthusiasm.',
    practical_guidance: 'Before launching, pause long enough to check whether the gut is actually saying yes — or whether you are reacting to urgency and excitement. Once the yes is genuine, move at full speed. When your direction changes — and it will — simply inform the people affected. Visualizing steps before action helps reduce wasted motion and gives others a chance to follow.',
    signature: 'Satisfaction & Peace',
    not_self: 'Frustration & Anger',
    pct: '33%',
    color: '#34d399',
  },
  Manifestor: {
    title: 'Manifestor',
    overview: 'You are one of the few types genuinely built to initiate — to create movement without waiting for an external prompt. Your energy has a self-contained, closed quality that allows you to start things, shift direction independently, and act without requiring external validation. Others feel the force of your movement even before you say anything. Throughout history, those who built new systems, started movements, or created change single-handedly often carried this design. The challenge is that this same initiating energy creates a field that others unconsciously resist — not to stop you, but because they do not know what you are doing and it unsettles them.',
    strategy: 'Inform before acting',
    strategy_explained: 'Informing is not asking permission — it is announcing your intention to the people who will be affected by your movement. When you do this, the resistance dissolves and you can move freely. When you skip it, you encounter friction that slows you down and creates conflict you did not plan for. The discipline of informing may feel counterintuitive when you are built to move independently, but the payoff is a remarkable freedom to act without walls appearing at every turn.',
    energy_pattern: 'Concentrated energy that comes in powerful bursts of initiation rather than sustained output. You are not designed to produce continuously — you initiate, complete the cycle, and then genuinely need rest. Periods of apparent inactivity are not laziness; they are the natural recovery that makes the next burst possible. Pushing through when the energy is not there creates the exhaustion and anger that signal misalignment.',
    alignment_signs: 'A deep feeling of peace and inner freedom. The ability to act on your intentions without running into walls at every turn. A sense of being in your own lane, moving at your own pace.',
    misalignment_signs: 'Anger — sometimes sharp and sudden. Persistent resistance from others that feels controlling or unfair. A sense of being blocked or not allowed to do what you know you need to do.',
    practical_guidance: 'Build the habit of informing before you act. Even a brief heads-up to the people your movement will affect creates the space you need. Rest without guilt when the initiating energy drops — not every moment is meant to be productive. Learning to distinguish genuine initiation from restless urgency is one of the most valuable distinctions you can develop.',
    signature: 'Peace',
    not_self: 'Anger',
    pct: '9%',
    color: '#f97316',
  },
  Projector: {
    title: 'Projector',
    overview: 'You are the natural guide — an observer and reader of systems, people, and energy. Without a defined Sacral, you are not built for the sustained motor energy that Generators carry, and attempting to match that pace depletes you in ways that are difficult to recover from. What you have instead is something rarer: a penetrating ability to see how things work, what is needed, and how to direct the energy of others efficiently. When you are in a role where your perception is genuinely seen and valued, you are extraordinary. The challenge is that this design depends entirely on being recognized and invited — unsolicited guidance, however accurate, tends to be rejected.',
    strategy: 'Wait for the recognition and invitation',
    strategy_explained: 'Your guidance becomes welcome when someone genuinely sees your capacity and asks for it. An invitation — to a relationship, a role, a project — signals that the other person is ready to receive what you offer. Going where you are not recognized and attempting to guide anyway creates bitterness and exhaustion. The invitation-first model is not a limitation; it is a precision instrument that ensures your wisdom lands where it can actually be used.',
    energy_pattern: 'Focused and selective rather than continuous. You can work intensely on things you love, but you need genuine rest — ideally a way to fully decompress and de-intensify. Your efficiency comes from working smarter, not longer. When you honor this and stop trying to match Generator energy, you discover that a few focused hours of aligned work outperforms exhausted grinding by a wide margin.',
    alignment_signs: 'Feeling genuinely recognized and valued. Being sought out and invited. A sense of success that comes not from pushing harder but from guiding others to use their energy well.',
    misalignment_signs: 'Bitterness from being consistently overlooked, unseen, or talked over. Deep exhaustion from trying to match the pace of types whose energy you are not designed to sustain.',
    practical_guidance: 'The most important investment you can make is developing your area of mastery so deeply that the right recognition is inevitable. Study, observe, and become genuinely expert at something. Do not force your way into situations — trust that the right invitations will come. When they do not, rest. Rest is never wasted for this type; it is the work that happens between the work.',
    signature: 'Success',
    not_self: 'Bitterness',
    pct: '20%',
    color: '#a78bfa',
  },
  Reflector: {
    title: 'Reflector',
    overview: 'You are the rarest type — roughly one in a hundred — and the most sensitive to your environment. With almost all centers open, your chart is a living mirror: you take in and amplify the energies, emotions, and conditioning of everyone around you. You are not meant to be consistent in the way other types are. You are meant to be variable, responsive, and extraordinarily perceptive. At your best you are a living barometer of the health and well-being of the communities and systems you inhabit. When things are going well around you, you reflect it. When something is off, you feel it before anyone else has named it.',
    strategy: 'Wait through a full lunar cycle before major decisions',
    strategy_explained: 'Because your experience of yourself changes with your environment and the transiting planets, you need time and variety of perspective before a decision can be trusted. Moving through a full 29-day lunar cycle allows you to feel the same question across many different configurations of energy and context. The clarity that arrives at the end of that process is genuinely reliable. The haste that skips it often needs to be undone. For major decisions, the lunar cycle is not a delay — it is the process.',
    energy_pattern: 'Fluid and variable, deeply tied to who and what you are around. Some days will feel energized and engaged; others will feel depleted and distant. This is not inconsistency — it is the nature of your design. You are meant to change with the context, not despite it. The moon\'s movement through your chart each month creates a natural rhythm that, once recognized, can become a source of orientation rather than confusion.',
    alignment_signs: 'A sense of genuine surprise and delight at life. Feeling at home in your environment. A lightness that comes from being in the right place with the right people. A sense that life is working.',
    misalignment_signs: 'Chronic disappointment. A deep sense of not quite belonging anywhere. A persistent feeling that something is fundamentally wrong — when what is actually wrong is the environment, not you.',
    practical_guidance: 'Environment is your most important variable. The quality of your community — the people, places, and rhythms you choose to be surrounded by — shapes your entire experience of yourself and of life. Give yourself the full lunar cycle for major decisions. When life feels bleak or unclear, change your environment before drawing conclusions about yourself.',
    signature: 'Surprise',
    not_self: 'Disappointment',
    pct: '1%',
    color: '#60a5fa',
  },
}

// ── Authorities ───────────────────────────────────────────────────────────────

export const HD_AUTHORITIES: Record<string, { title: string; description: string; guidance: string }> = {
  'Emotional / Solar Plexus': {
    title: 'Emotional Authority',
    description: 'Your emotional system moves in waves — natural cycles that rise from hope and excitement, dip through uncertainty and sometimes pain, and eventually settle at a still, clear point in the middle. Neither the peak of the wave nor the valley is the right moment to make a decision. The highs paint things as more perfect than they are; the lows make everything seem worse. The clarity you are looking for lives at the still point that arrives after the wave has cycled through — when something feels right not because it excites you, but because it simply feels true and settled.',
    guidance: 'Give yourself time. Wait through the full arc of the emotional wave before committing to anything significant — ideally sleeping on a decision, and sometimes waiting days or weeks for major ones. If the answer still feels clear and right after you have moved through both the excitement and the doubt, it is correct for you. Spontaneous decisions made at the emotional peak almost always need to be revisited. Patience is not a weakness here — it is your most powerful tool.',
  },
  Sacral: {
    title: 'Sacral Authority',
    description: 'Your gut response is your most reliable intelligence, and it lives in your body, not your mind. Before the mind has a chance to analyze or rationalize, your Sacral gives a spontaneous, physical signal: an energetic uh-huh for yes, an energetic uh-uh for no, or a flat neutrality that means not now or not this. This is not metaphor — it is a real, felt sensation that operates independently of thought. It is immediate, present-moment, and surprisingly consistent when you learn to listen for it rather than override it.',
    guidance: 'Practice recognizing the gut response in small daily situations before relying on it for larger ones. Ask yourself yes/no questions and notice the physical reaction before the mind weighs in. The Sacral speaks in response to something real in front of you — it cannot be conjured through analysis or deliberation. When there is no response, that itself is an answer: not now, not this. The Sacral knows; the challenge is trusting it over the louder voice of social conditioning and mental pressure.',
  },
  Splenic: {
    title: 'Splenic Authority',
    description: 'Your authority is instantaneous — a single pulse of intuitive awareness in the moment that something is right or wrong, safe or not, correct or off. The Spleen senses through taste, smell, instinct, and a feeling of well-being or unease. It is the quietest of all the authorities — almost a whisper — and it does not repeat itself or wait for you to be ready. It arrives once, in the present moment, and then it is gone.',
    guidance: 'Catch the first impression. The Spleen\'s signal lives in the blink of an eye, not in extended deliberation. If you find yourself going back and forth, you have likely already passed the moment of genuine knowing. Trust the first quiet pulse, even when it seems hard to justify logically, and even when others urge you to take more time. Hesitation is a sign you have left the body and entered the mind — which is not where your authority lives.',
  },
  'Ego / Will': {
    title: 'Ego Authority',
    description: 'What your heart genuinely wants — not what you think you should want, not what others need from you, not what seems like the responsible choice — is your navigational system. Your willpower is directly connected to desire. When you genuinely want something, you have the drive to make it happen and the stamina to see it through. When you do not truly want it, the will deflates no matter how much logic or obligation pushes you forward.',
    guidance: 'Ask yourself honestly: do I want this? Not whether it seems like a good idea, or whether others expect it, but whether your heart is actually in it. Commitments made from genuine desire tend to succeed and to sustain you. Commitments made from obligation or social pressure deplete your willpower and tend to collapse. When your heart soars at the idea of something, that is your yes. When it contracts, that is your no — regardless of what the circumstances seem to suggest.',
  },
  'Self-Projected': {
    title: 'Self-Projected Authority',
    description: 'You access clarity through the sound of your own voice. When you speak your thoughts out loud to someone you trust — not to get their advice, but simply to hear yourself — something in the process of expression allows you to discover what is actually true for you. The listener is a witness, not a consultant. The answer emerges through the act of speaking, often mid-sentence, as something clicks into place.',
    guidance: 'Find people who can listen without redirecting. Talk through decisions out loud — not to receive input but to hear yourself think. You will notice that clarity arrives during the speaking rather than before it. If a conversation steers you toward the other person\'s perspective rather than your own, find another sounding board. The goal is to hear your own voice reflect back what you already know.',
  },
  'Lunar / Reflector': {
    title: 'Lunar Authority',
    description: 'As a Reflector, your decision-making process is tied to the 29-day lunar cycle. Because your open centers mean your experience of yourself and of any given question shifts continuously with your environment and the transiting planets, the same decision can feel completely different from one week to the next — and all of those perspectives are real. The reliability you need cannot be found in a single day or a single feeling. It builds across the full cycle, as the moon activates each part of your chart in turn.',
    guidance: 'When a significant decision arises, mark a date 29 days out and begin gathering perspectives — from books, conversations, different environments, different days. Notice which feeling or answer keeps returning across the variety of experiences. The consistent thread across the full month is the reliable signal. For truly major decisions, the full cycle is not optional; it is the process. With practice, you will begin to anticipate your own patterns and sometimes know the answer before the cycle completes.',
  },
}

// ── Centers ───────────────────────────────────────────────────────────────────

export const HD_CENTERS_DATA: Record<string, CenterData> = {
  Head: {
    defined_short: 'Consistent inspiration pressure',
    undefined_short: 'Receives questions and ideas from others',
    defined_detail: 'Your mind is under consistent pressure to find meaning, resolve questions, and understand what is true. Inspiration arrives with a sense of urgency — a drive to figure things out. You tend to return repeatedly to the same themes from different angles until something resolves or clicks. This mental pressure is real and energizing when directed well, but it can be exhausting if you feel obligated to answer every question it raises. Learning which questions are genuinely yours to pursue — and which are simply the nature of the center running — brings a great deal of relief.',
    undefined_detail: 'Your Crown acts as a receptive dish for the ideas, inspirations, and questions of those around you. This openness makes you genuinely curious and responsive to new thinking, but it also means you can spend significant energy trying to resolve questions that belong to someone else entirely. The most freeing practice available to you is asking: "Is this question actually mine to answer?" When the answer is no, you are allowed to set it down. The wisdom of this center comes not from carrying every inspiration but from recognizing which ones are truly calling you forward.',
    color: '#ddd6fe',
  },
  Ajna: {
    defined_short: 'Fixed, consistent way of processing',
    undefined_short: 'Flexible, multi-perspective mind',
    defined_detail: 'Your mind operates from a consistent and recognizable way of processing information. You tend to form strong opinions and prefer frameworks that hold up under scrutiny. Once you have analyzed something and reached a conclusion, that conclusion is reliable — which is both a genuine strength and an occasional limitation when new information invites a change of perspective. People can count on you to think things through with consistency and to return to the same approach each time, which makes you trustworthy and clear in how you engage with ideas.',
    undefined_detail: 'Your mind is genuinely flexible — you can hold multiple perspectives simultaneously without needing to resolve them into a single conclusion. This is not indecisiveness; it is a form of openness that allows you to access the thinking of many different designs and see what they cannot. The invitation is to stop pretending you have certainty when your actual gift is fluid understanding. You are not here to fix your opinions into place — you are here to move freely through the landscape of ideas and reflect back what others are too close to their own viewpoints to see.',
    color: '#c4b5fd',
  },
  Throat: {
    defined_short: 'Reliable expression and manifestation',
    undefined_short: 'Variable voice; pressure to speak',
    defined_detail: 'You have consistent access to expression and the capacity to make things happen through speaking, writing, or action. Your voice carries a particular quality that others notice — there is a reliability and impact to what you say. All roads in your design tend to lead to the Throat, meaning your various centers seek expression and manifestation through this hub. When you speak, you tend to catalyze something — in yourself and in the people listening. The Throat is also where you facilitate the expression of others; people may find themselves more vocal and forthcoming in your presence.',
    undefined_detail: 'How you communicate shifts significantly depending on who you are with and what energy is in the room. This can produce moments of surprising eloquence and, at other times, an unexpected blankness. You may feel a strong internal pressure to speak — to fill silence, to get attention, to prove you have something to say — but this pressure is often coming from outside you rather than from a genuine impulse. Waiting for the right environment and the right moment, rather than forcing expression, produces your most impactful communication and takes the strain off a center that is not designed to be constantly active.',
    color: '#93c5fd',
  },
  'G': {
    defined_short: 'Stable identity and life direction',
    undefined_short: 'Fluid identity shaped by environment',
    defined_detail: 'You carry a relatively stable sense of who you are and where you are going. Even through disruption and change, there is a thread of identity that holds. This consistency in direction tends to be magnetic — others feel your sense of purpose and are drawn to it, often looking to you as a compass. You can be counted on to maintain a clear orientation even when circumstances are shifting around you. There is something certain and solid about your character that others find both reassuring and compelling.',
    undefined_detail: 'Your sense of identity and direction in life is fluid and genuinely responsive to your environment. You change depending on who you are with and where you are — this is not confusion or lack of self, it is design. You are built to experience life through many different lenses and to reflect something essential back to others about who they are. The wisdom here is to choose your environments and companions with care, since they shape your experience of yourself profoundly. In the right surroundings, you feel purposeful and clear. In the wrong ones, you can lose your sense of direction entirely.',
    color: '#fde68a',
  },
  'Ego': {
    defined_short: 'Consistent willpower and drive',
    undefined_short: 'Variable motivation; nothing to prove',
    defined_detail: 'You have reliable access to willpower, determination, and the ability to commit and follow through on what you set your heart on. When your heart is genuinely in something, your capacity to make it happen is formidable — you can move mountains through sheer sustained will. This is a rare center to have defined, and it comes with a real responsibility: rest is essential. The will needs genuine recovery time or it burns out in ways that can take a long time to repair. The key is ensuring your commitments are genuinely chosen rather than assumed or inherited from others\' expectations.',
    undefined_detail: 'Your willpower is not meant to be constant — it comes and goes, and that is by design. The pressure to prove yourself, compete, or demonstrate your worth is often a conditioning influence that arrives from the defined Ego centers of those around you. When you feel that pressure, it is usually not yours. The invitation is to release the need to prove anything — to yourself or to others. You are not here to flex willpower on demand but to act when genuine drive is available and rest without guilt when it is not. There is nothing wrong with you when the will is quiet.',
    color: '#fca5a5',
  },
  'Solar Plexus': {
    defined_short: 'Emotional waves cycle through highs and lows',
    undefined_short: 'Amplifies and absorbs others\' emotions',
    defined_detail: 'Your emotional system moves in natural waves — peaks of hope, excitement, and connection; valleys of uncertainty, sadness, or pain; and eventually a still point in the middle where genuine clarity lives. These waves are not a problem to solve; they are the medium through which you develop emotional wisdom over time. The key is learning not to make permanent decisions from temporary emotional states, whether high or low. Over years of practice, you learn to recognize the still point — and that is when your authority is available.',
    undefined_detail: 'You are highly sensitive to the emotional field around you. You can walk into a room and feel what everyone is feeling before a single word is spoken. This is a real gift but also a real challenge — the emotions you feel are often not yours, and the distinction can be very difficult to hold in the moment. Practices that help you clear and ground your emotional field are important, as is time away from intense or turbulent emotional environments. When you feel overwhelmed by emotion, it is worth asking: is this mine, or am I carrying someone else\'s wave?',
    color: '#fed7aa',
  },
  Spleen: {
    defined_short: 'Stable in-the-moment intuition',
    undefined_short: 'Heightened sensitivity; holds on out of fear',
    defined_detail: 'You have consistent access to in-the-moment intuition — a reliable, present-tense sense of what is healthy, safe, or correct in any given situation. Your body knows things before your mind has time to analyze them. This center is your immune system intelligence: physical, instinctive, and immediate. It does not speak in reasons; it speaks in felt knowing. When you honor these signals, you tend to stay healthy and out of harm\'s way. When you override them in favor of what seems logical or socially expected, the body tends to let you know.',
    undefined_detail: 'You are finely attuned to health, safety, and well-being signals in your environment — often picking up on subtle cues that others miss entirely. The challenge is that this sensitivity can also translate into heightened fear responses, particularly around letting go. You may hold onto things, people, or situations that no longer feel healthy because the fear of what releasing them will feel like is louder than the discomfort of staying. Learning to trust that releasing what no longer fits is an act of self-care rather than loss is one of the central teachings of this open center.',
    color: '#bfdbfe',
  },
  Sacral: {
    defined_short: 'Consistent, renewable life force energy',
    undefined_short: 'Absorbs others\' energy; needs recovery time',
    defined_detail: 'You have consistent access to powerful life-force energy — the engine that drives the Human Design system. When you are engaged with work, relationships, and activities that genuinely call to you, this energy is renewable: it replenishes itself through use rather than depleting. It is motor energy meant to be fully engaged and then fully rested. The work of a defined Sacral is to stay attuned to the gut response so that this enormous energy is consistently directed at what is truly correct rather than what is expected or convenient.',
    undefined_detail: 'You do not have a consistent internal motor, which means your energy is significantly shaped by who and what is around you. In the presence of defined Sacral beings, you can feel powerfully energized — sometimes more than your system can actually sustain. This often leads to overextension that is difficult to recognize in the moment because the borrowed energy feels like your own. Building in genuine rest, being selective about your environments, and learning to leave social situations before you are completely depleted are among the most important health practices available to you.',
    color: '#bbf7d0',
  },
  Root: {
    defined_short: 'Steady pressure and drive to complete',
    undefined_short: 'Absorbs adrenaline; tendency to rush',
    defined_detail: 'You have a consistent relationship with pressure — the adrenaline-driven drive to get things done, handle stress, and keep moving forward. This pressure is a genuine resource when directed intentionally: it enables you to work steadily under demanding conditions and maintain momentum across long-term projects. The key is learning to work with this pressure as a conscious tool rather than letting it drive you on autopilot. When you choose how to channel it, it is one of the most productive forces in the design system.',
    undefined_detail: 'You absorb the adrenal pressure of those around you, which can create a persistent feeling of urgency that is not actually yours. The impulse to rush through tasks just to relieve that pressure — to get it off your plate — can become a pattern that keeps you perpetually reactive and hurried. Learning to pause before acting, and to ask whether the urgency is genuinely yours or simply an energy you have taken on from your environment, gives you back your own pace and allows you to move at a rhythm that actually suits you.',
    color: '#d1fae5',
  },
}

// ── Channels ──────────────────────────────────────────────────────────────────

export const HD_CHANNELS_DATA: Record<string, ChannelData> = {
  '1-8': {
    name: 'Creative Contribution',
    centers: ['G', 'Throat'],
    keywords: ['creativity', 'influence', 'original direction'],
    description: 'A natural drive to express originality in ways that impact others. This channel brings a consistent creative force that wants to find its way into the world. Influence comes through authentic expression rather than imitation.',
  },
  '2-14': {
    name: 'Direction of Resources',
    centers: ['G', 'Sacral'],
    keywords: ['inner direction', 'resources', 'alignment'],
    description: 'A natural alignment between inner knowing and the energy to support it. Resources — time, money, attention — tend to flow toward what feels genuinely correct. This is a receptive channel that works best when not forced.',
  },
  '3-60': {
    name: 'Mutation',
    centers: ['Sacral', 'Root'],
    keywords: ['adaptation', 'chaos', 'innovation'],
    description: 'Energy for transforming limitation into something new. Growth often comes through periods of disorder followed by sudden breakthrough. This channel carries the pressure to disrupt patterns that have run their course.',
  },
  '4-63': {
    name: 'Logic',
    centers: ['Ajna', 'Head'],
    keywords: ['questions', 'answers', 'mental patterns'],
    description: 'A need to understand the world through logical frameworks. This channel generates pressure to find answers that hold up over time and can be proven. Mental restlessness is relieved when a clear pattern emerges.',
  },
  '5-15': {
    name: 'Rhythm',
    centers: ['Sacral', 'G'],
    keywords: ['timing', 'natural flow', 'cycles'],
    description: 'A natural attunement to rhythms and patterns in daily life. When in sync with personal timing, things unfold with ease. Forcing against natural rhythm creates friction.',
  },
  '6-59': {
    name: 'Intimacy',
    centers: ['Solar Plexus', 'Sacral'],
    keywords: ['bonding', 'emotional connection', 'closeness'],
    description: 'Energy for forming and maintaining deep connections. Intimacy happens through a combination of emotional sensitivity and physical or creative engagement. Boundaries matter as much as openness.',
  },
  '7-31': {
    name: 'Leadership',
    centers: ['G', 'Throat'],
    keywords: ['guidance', 'direction', 'collective voice'],
    description: 'A voice for guiding groups and collectives. This leadership works best when it is recognized and elected rather than self-appointed. The direction offered here is genuinely useful to others.',
  },
  '9-52': {
    name: 'Concentration',
    centers: ['Sacral', 'Root'],
    keywords: ['focus', 'stillness', 'detailed attention'],
    description: 'The capacity to sustain deep focus over time. Stillness is productive here — the energy for concentration is real but requires the right conditions. Rushing undermines the precision this channel enables.',
  },
  '10-20': {
    name: 'Awakening',
    centers: ['G', 'Throat'],
    keywords: ['authenticity', 'presence', 'living values'],
    description: 'Expression of true self in the present moment. This channel carries a natural pull toward living authentically and making it visible. Simply being oneself has an awakening effect on others.',
  },
  '10-34': {
    name: 'Exploration',
    centers: ['G', 'Sacral'],
    keywords: ['self-direction', 'independence', 'personal power'],
    description: 'A strong drive to follow one\'s own path with consistent energy behind it. Growth comes through self-led experience. This channel values autonomy and learns through direct engagement with life.',
  },
  '10-57': {
    name: 'Perfected Form',
    centers: ['G', 'Spleen'],
    keywords: ['intuition', 'alignment', 'embodied awareness'],
    description: 'A refined, intuitive sense of what feels correct for the body and being. This channel brings a quiet confidence that comes from being in alignment. Decisions that honor the body naturally support overall well-being.',
  },
  '11-56': {
    name: 'Curiosity',
    centers: ['Ajna', 'Throat'],
    keywords: ['ideas', 'storytelling', 'meaning-making'],
    description: 'An endless stream of ideas that wants to be shared through stories and teaching. This channel is stimulated by novelty and thrives when there is an audience for its insights. Meaning is found through exploration and expression.',
  },
  '12-22': {
    name: 'Openness',
    centers: ['Throat', 'Solar Plexus'],
    keywords: ['mood', 'emotional expression', 'social grace'],
    description: 'Emotional expression that is deeply tied to mood and timing. When the feeling is right, communication flows beautifully. Forcing expression when the mood is not there results in flatness. Waiting for the right moment is key.',
  },
  '13-33': {
    name: 'Reflection',
    centers: ['G', 'Throat'],
    keywords: ['memory', 'listening', 'collective stories'],
    description: 'A capacity to gather, hold, and share the stories of others. This channel is a natural listener and keeper of wisdom. Insight comes through looking back and making meaning from experience.',
  },
  '16-48': {
    name: 'Talent',
    centers: ['Throat', 'Spleen'],
    keywords: ['mastery', 'skill', 'depth of practice'],
    description: 'Natural ability that is refined and deepened through repetition and practice. This channel carries enthusiasm for developing real skill. Depth — not surface — is what gives this energy its value.',
  },
  '17-62': {
    name: 'Acceptance',
    centers: ['Ajna', 'Throat'],
    keywords: ['opinions', 'logical detail', 'organized thinking'],
    description: 'The ability to articulate structured, detailed thinking in a way others can follow. This channel forms opinions through logic and expresses them clearly. Credibility builds through precision and evidence.',
  },
  '18-58': {
    name: 'Judgment',
    centers: ['Spleen', 'Root'],
    keywords: ['refinement', 'correction', 'improvement drive'],
    description: 'A persistent drive to identify what is not working and improve it. This channel is skilled at noticing flaws and finding solutions. The challenge is discerning when to engage with the correction impulse and when to let things be.',
  },
  '19-49': {
    name: 'Sensitivity',
    centers: ['Root', 'Solar Plexus'],
    keywords: ['needs', 'principles', 'emotional awareness'],
    description: 'Deep sensitivity to the needs and feelings within relationships. This channel drives changes in values and agreements when needs are not met. Strong principles guide what this energy will and will not accept.',
  },
  '20-34': {
    name: 'Charisma',
    centers: ['Throat', 'Sacral'],
    keywords: ['action', 'power', 'doing in the now'],
    description: 'Immediate, powerful action fueled from within. Impact comes from doing rather than planning. This channel carries a magnetic quality — others feel the energy and want to be around it.',
  },
  '20-57': {
    name: 'Clarity in the Now',
    centers: ['Throat', 'Spleen'],
    keywords: ['intuition', 'spontaneous awareness', 'presence'],
    description: 'Immediate intuitive awareness expressed in real time. Clarity arises in the moment without needing to think. This channel speaks what it knows before the mind has time to filter it.',
  },
  '21-45': {
    name: 'Control',
    centers: ['Ego', 'Throat'],
    keywords: ['management', 'resources', 'material authority'],
    description: 'A capacity to manage, direct, and organize resources — people, money, systems. This channel carries natural authority over material life. It works best when its leadership role is acknowledged.',
  },
  '23-43': {
    name: 'Structuring',
    centers: ['Throat', 'Ajna'],
    keywords: ['breakthrough insight', 'simplification', 'clarity'],
    description: 'Unique insights that need the right timing and framing to land. The ability to take complex or unusual knowing and make it accessible. Speaking too early or too often can make this channel seem incoherent to others.',
  },
  '24-61': {
    name: 'Awareness',
    centers: ['Ajna', 'Head'],
    keywords: ['inner truth', 'mystery', 'deep knowing'],
    description: 'A mind that returns repeatedly to certain truths trying to understand them. Insight develops through repetition of thought rather than through linear reasoning. This channel carries pressure to know what cannot easily be explained.',
  },
  '25-51': {
    name: 'Initiation',
    centers: ['G', 'Ego'],
    keywords: ['courage', 'shock', 'awakening spirit'],
    description: 'Energy for initiating through disruption and surprise. This channel can withstand and even welcome experiences that others find overwhelming. Growth often begins with the unexpected.',
  },
  '26-44': {
    name: 'Transmission',
    centers: ['Ego', 'Spleen'],
    keywords: ['persuasion', 'instinct', 'strategic communication'],
    description: 'The ability to transmit messages with impact, timing, and instinctive appeal. This channel has a natural feel for what others need to hear and when. Marketing, selling, and influential storytelling are natural expressions.',
  },
  '27-50': {
    name: 'Preservation',
    centers: ['Sacral', 'Spleen'],
    keywords: ['care', 'responsibility', 'nurturing others'],
    description: 'A deep drive to care for others and maintain the integrity of communities and relationships. This channel feels responsible for the well-being of those it is connected to. The challenge is not losing oneself in that care.',
  },
  '28-38': {
    name: 'Struggle',
    centers: ['Spleen', 'Root'],
    keywords: ['purpose', 'challenge', 'finding meaning in difficulty'],
    description: 'A drive to engage with challenge and find meaning in it. This channel does not shy away from difficulty — it looks for the worth in the fight. The question it carries is: what is worth struggling for?',
  },
  '29-46': {
    name: 'Discovery',
    centers: ['Sacral', 'G'],
    keywords: ['commitment', 'embodied experience', 'saying yes'],
    description: 'Energy for deep commitment to experience. This channel says yes to life and learns through full engagement. The challenge is being selective about what to commit to, because the commitment is total.',
  },
  '30-41': {
    name: 'Desire',
    centers: ['Solar Plexus', 'Root'],
    keywords: ['longing', 'fantasy', 'new experiences'],
    description: 'Emotional pressure for new experiences and the energy of desire. This channel is always drawn toward what has not yet been felt or tried. The richness of experience — not its permanence — is what matters.',
  },
  '32-54': {
    name: 'Transformation',
    centers: ['Spleen', 'Root'],
    keywords: ['ambition', 'instinct for success', 'long-term growth'],
    description: 'A strong drive for material growth and transformation over time. Instinct guides this channel toward what will succeed and what will not. Ambition is real here — and grounded in survival awareness.',
  },
  '34-57': {
    name: 'Power',
    centers: ['Sacral', 'Spleen'],
    keywords: ['instinctive power', 'survival', 'deep energy'],
    description: 'Raw energy guided by intuition. This channel is deeply instinctive and built for independent survival and action. Power comes from within and does not require external validation.',
  },
  '35-36': {
    name: 'Experience',
    centers: ['Throat', 'Solar Plexus'],
    keywords: ['change', 'emotional growth', 'crisis as catalyst'],
    description: 'Learning through emotional and experiential change. This channel is drawn toward the edge of what it has not yet felt or done. Crisis often precedes the growth this channel is built for.',
  },
  '37-40': {
    name: 'Community',
    centers: ['Solar Plexus', 'Ego'],
    keywords: ['family bonds', 'agreements', 'mutual support'],
    description: 'Focus on building and maintaining community through clear agreements. This channel values loyalty and reciprocity. When agreements are honored, energy flows. When they are broken, the bond dissolves.',
  },
  '39-55': {
    name: 'Emoting',
    centers: ['Root', 'Solar Plexus'],
    keywords: ['emotional provocation', 'spirit', 'abundance potential'],
    description: 'Pressure to provoke emotional response in others and in oneself. This channel stirs the spirit and can trigger depth of feeling. Mood is a significant factor in how this energy is expressed.',
  },
  '42-53': {
    name: 'Cycles',
    centers: ['Sacral', 'Root'],
    keywords: ['completion', 'growth cycles', 'beginning to end'],
    description: 'Energy for completing what has been started and seeing cycles through from beginning to end. Satisfaction comes from full completion. Starting new cycles before finishing old ones creates a backlog of unfinished business.',
  },
  '47-64': {
    name: 'Abstraction',
    centers: ['Ajna', 'Head'],
    keywords: ['mental pressure', 'confusion resolving into insight', 'making sense of experience'],
    description: 'A mind under pressure to make sense of the past. Confusion is not a problem here — it is the beginning of the process. Clarity and realization arrive after the mind has had time to process accumulated experience.',
  },
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export const HD_PROFILES: Record<string, ProfileData> = {
  '1/3': {
    name: 'Investigator / Martyr',
    description: 'You are a natural researcher with an experimental streak — a combination that drives you to understand things deeply and then test that understanding directly in the world. The investigator in you craves solid foundations: you genuinely need to feel grounded in knowledge before you can fully commit. But the martyr line learns by doing, by testing, and by sometimes failing spectacularly. The result is a personality that is both thorough and restless, cautious and experimental. Life for a 1/3 is a series of trial runs that build genuine, tested wisdom over time. What did not work is as valuable to you as what did — perhaps more so. The insecurity you sometimes feel is real, but the antidote is knowledge, not certainty.',
  },
  '1/4': {
    name: 'Investigator / Opportunist',
    description: 'You carry the research drive of the first line alongside the social reach of the fourth, and both are essential. Security, for you, is built on two pillars: what you genuinely know and who genuinely knows you. You are thorough and careful before committing — you need to understand the whole picture before opening your heart or your calendar. But your network is equally central to how life works for you: opportunities arrive through people who trust you, and your impact flows outward through those same connections. The combination makes you someone who is both deeply reliable and genuinely well-connected — a person others turn to because they know you will have done your homework and because they know you personally.',
  },
  '2/4': {
    name: 'Hermit / Opportunist',
    description: 'You have a natural gift that you yourself may not fully see or appreciate. The second line operates from an almost unconscious talent — something that comes so naturally it does not feel like anything special. Meanwhile, the fourth line is deeply oriented toward people and relationships as the primary channel through which life moves. The tension in this profile is between the genuine need for solitude and withdrawal — time to develop, integrate, and simply be yourself without being observed — and the pull of the social world that is essential to how your opportunities actually arrive. Others will often recognize your gifts before you do and call you out of your inner world. Trust those calls when they come from people who genuinely see you.',
  },
  '2/5': {
    name: 'Hermit / Heretic',
    description: 'You carry both a natural, somewhat unconscious talent and a powerful projection field — people consistently see in you the solution to whatever problem they are currently facing. This is partly accurate and partly fantasy. The hermit in you works best from a place of solitude and natural emergence; the fifth line broadcasts something that others interpret as a universal, practical answer. The gap between who you actually are and who others believe you to be can feel significant. Learning to be highly selective about which invitations you step into — and whose projection of you is actually grounded in reality — is central to your path. When the fit is genuine, your impact can be remarkable.',
  },
  '3/5': {
    name: 'Martyr / Heretic',
    description: 'You are here to learn through direct experience — including the experiences that bruise. The third line in you is experimental, adaptive, and genuinely resilient; you have a capacity to try, fail, adjust, and try again that others find both admirable and exhausting to watch. You have tested more approaches to more situations than almost anyone else, and that accumulated trial-and-error is not a record of failure — it is the source of your practical wisdom. The fifth line means others will look to you for workable, real-world solutions. And you often have them, not because of theory, but because you have already been through the equivalent situation yourself. Your wisdom is hard-won and genuine.',
  },
  '3/6': {
    name: 'Martyr / Role Model',
    description: 'Your life tends to move through distinct stages with different qualities. In the early phase, you live through the exhilarating experimentation of the third line — testing, discovering, sometimes burning yourself on the things you touch, learning what works by living through what does not. Somewhere in mid-life, the sixth line gradually comes forward: you begin stepping back from the front lines of raw experience, gaining perspective, and finding that others start looking to you as someone who has genuinely been through it all. In later life, the hard-won wisdom of your earlier years becomes the foundation for a genuine role-model quality — an authority that cannot be faked because it was earned through living.',
  },
  '4/6': {
    name: 'Opportunist / Role Model',
    description: 'You are deeply invested in relationships and carry the long-horizon perspective of the sixth line. The fourth-line part of you knows instinctively that life works through people — through networks, friendships, and the trust built patiently over time. The sixth line adds an overseeing quality: you can see the bigger picture and are drawn toward positions where that perspective can guide others. The tension in this profile is between the warmth and relational hunger of the fourth line and the occasional need for the sixth-line detachment that wise oversight requires. As you mature, these two parts integrate more naturally and you become someone who is both deeply connected and genuinely far-sighted.',
  },
  '4/1': {
    name: 'Opportunist / Investigator',
    description: 'You are a rare fixed profile — one of the most particular and self-contained of the twelve. Your path has a singular quality, and life works best when you stay true to it rather than being pulled off course by others\' visions for you. Opportunities arrive through your relationships and your network; your security is built on a foundation of genuine, thorough knowledge. Both the heart and the mind must be engaged for you to be at your best. When you find your true path, you tend to recognize it with unmistakable clarity. When you have strayed from it, the discomfort is equally unmistakable — and equally useful.',
  },
  '5/1': {
    name: 'Heretic / Investigator',
    description: 'You are a natural problem-solver and leader with a gift for seeing what others miss and finding practical paths through complexity. Others consistently project onto you the capacity to rescue, fix, or provide the answer — and when you are genuinely prepared, you often can. The investigator line is not optional for this profile: the fifth-line projection field will be aimed at you regardless of whether you are ready, so having real knowledge and practical solutions to back it up is what separates a fulfilling experience from an overwhelming one. Deep, thorough preparation makes this a remarkable profile. The person who wings it here finds the projection quickly becomes a burden.',
  },
  '5/2': {
    name: 'Heretic / Hermit',
    description: 'You carry the projection field of the fifth line — others see in you a source of practical wisdom and leadership — alongside the natural, somewhat unconscious talent of the second. This creates an interesting dynamic: you may find yourself being called into roles of influence before you have fully recognized your own capacities, and you may step into them with a naturalness that surprises even you. The reclusive second-line pull can make full engagement feel uncomfortable, while the fifth-line energy calls you outward. When you find the balance between genuine emergence and necessary solitude, you discover a range of natural ability that runs deeper than you knew.',
  },
  '6/2': {
    name: 'Role Model / Hermit',
    description: 'You have likely always carried a certain authority that others feel even before you have said much. The sixth line grants a long-range vision and a capacity for wisdom that can seem innate — as though you arrived with knowledge already in place. The second line means you have natural gifts that you access somewhat spontaneously, often without fully appreciating them yourself. Your life tends to unfold in recognizable phases: early experimentation and engagement, a middle period of consolidation and selective retreat, and a later stage in which your lived experience becomes genuinely instructive to those around you. The role-model quality is not a performance — it is what emerges when you have lived enough to embody what you know.',
  },
  '6/3': {
    name: 'Role Model / Martyr',
    description: 'You combine the natural authority and far-sightedness of the sixth line with the experiential intensity and resilience of the third. The result is someone who has genuinely lived — who has been in the thick of it, tested the edges, learned from everything including the things that went wrong — and arrived at a place of embodied authority that no amount of studying could produce. Unlike someone who observes life from a safe distance and theorizes about what is possible, you know from direct experience. That directness is precisely what gives your role-model quality its credibility and power. You do not speak in abstractions — you speak from what you have lived.',
  },
}

// ── Gate Keywords ─────────────────────────────────────────────────────────────

export const GATE_KEYWORDS: Record<number, string[]> = {
  1: ['creativity','self-expression','original direction'],
  2: ['receptivity','inner knowing','receiving guidance'],
  3: ['ordering chaos','mutation','new beginnings from disorder'],
  4: ['logical answers','problem-solving','mental formulation'],
  5: ['rhythm','consistent patterns','natural timing'],
  6: ['emotional boundaries','intimacy','friction that creates growth'],
  7: ['leadership through example','role modeling direction'],
  8: ['contribution','style','making an impact'],
  9: ['focused detail','concentration','persistence'],
  10: ['authentic behavior','self-love','living by values'],
  11: ['conceptual ideas','imagination','exploring possibilities'],
  12: ['caution in expression','emotional communication','selectivity'],
  13: ['listening','collective memory','holding stories'],
  14: ['resource skills','aligned power','material competence'],
  15: ['embracing extremes','humanitarian flow','adaptability'],
  16: ['enthusiasm','skill development','mastery through practice'],
  17: ['structured opinions','logical mind','need for evidence'],
  18: ['refinement','correction','critical improvement'],
  19: ['sensitivity to needs','emotional closeness','awareness of others'],
  20: ['presence','action in the now','awareness of the moment'],
  21: ['control','management','authority over material'],
  22: ['grace','social openness','mood-based expression'],
  23: ['simplification','translating the unusual','breakthrough insight'],
  24: ['mental repetition','rationalization','returning to understand'],
  25: ['universal love','innocence','spirit'],
  26: ['persuasion','strategic storytelling','influential memory'],
  27: ['nurturing','care for others','preservation'],
  28: ['struggle for meaning','risk-taking','finding purpose'],
  29: ['commitment','saying yes to life','perseverance'],
  30: ['desire','intensity of feeling','longing for experience'],
  31: ['collective leadership','democratic voice','influence over groups'],
  32: ['continuity','material instinct','knowing what will last'],
  33: ['retreat','privacy','reflection on experience'],
  34: ['raw power','self-driven energy','independence'],
  35: ['progress','change through experience','seeking the new'],
  36: ['emotional growth through crisis','transition','depth of feeling'],
  37: ['family bonds','community agreements','loyalty'],
  38: ['fighting for meaning','resilience','purpose through challenge'],
  39: ['provocateur','emotional awakening','stirring things up'],
  40: ['willpower','work and rest balance','self-reliance'],
  41: ['new cycle pressure','imagination','desire for the unexperienced'],
  42: ['completion of cycles','growth through finishing'],
  43: ['inner knowing','breakthrough','individualistic insight'],
  44: ['pattern recognition','instinct for the past','alertness'],
  45: ['material leadership','ownership','community resources'],
  46: ['love of the body','embodied luck','physical experience'],
  47: ['mental realization','making sense of chaos','delayed insight'],
  48: ['depth of knowledge','resourcefulness','fear of inadequacy'],
  49: ['principles over comfort','emotional revolution','values-based change'],
  50: ['values','responsibility for others','maintaining integrity'],
  51: ['initiation through shock','courage in the face of the unexpected'],
  52: ['stillness','meditative focus','waiting for the right moment'],
  53: ['new beginnings','developmental pressure','starting cycles'],
  54: ['ambition','drive for material betterment','working toward goals'],
  55: ['emotional spirit','abundance','mood-based creativity'],
  56: ['storytelling','stimulation through ideas','sharing experience'],
  57: ['intuitive clarity','in-the-moment knowing','survival instinct'],
  58: ['joy in improvement','vitality','drive to perfect'],
  59: ['intimacy and bonding','breaking down barriers'],
  60: ['limitation as creative pressure','working within structure'],
  61: ['inner truth','mystery','pressure to know the unknowable'],
  62: ['precise expression','naming things','detail-oriented thinking'],
  63: ['doubt as the beginning of logic','questioning','hypothesis'],
  64: ['mental pressure from the past','confusion as precursor to insight'],
}

// ── Planet Display Names ──────────────────────────────────────────────────────

export const PLANET_LABELS: Record<string, string> = {
  sun: '☉ Sun',
  earth: '⊕ Earth',
  moon: '☽ Moon',
  mercury: '☿ Mercury',
  venus: '♀ Venus',
  mars: '♂ Mars',
  jupiter: '♃ Jupiter',
  saturn: '♄ Saturn',
  uranus: '♅ Uranus',
  neptune: '♆ Neptune',
  pluto: '♇ Pluto',
  north_node: '☊ N.Node',
}

// ── Compatibility Data ────────────────────────────────────────────────────────

export interface TypeDynamic {
  score: number       // 0–100 base compatibility score
  label: string       // short relationship archetype name
  description: string
  growth: string      // what this pairing challenges each to develop
  strength: string    // what this pairing does well together
}

// Key: "TypeA|TypeB" — always sorted alphabetically to avoid duplicates
export const TYPE_DYNAMICS: Record<string, TypeDynamic> = {
  'Generator|Generator': {
    score: 82,
    label: 'Steady Builders',
    description: 'Two Generators create a stable, productive partnership with consistent life-force energy. Each understands the other\'s need to wait and respond before committing.',
    strength: 'Sustained effort, mutual encouragement, deeply satisfying shared work.',
    growth: 'Can both become over-committed and need to check in on what still brings genuine response.',
  },
  'Generator|Manifesting Generator': {
    score: 85,
    label: 'Engine Room',
    description: 'Both are Sacral beings who understand responding as a way of life. The MG\'s multi-channel speed can inspire the Generator; the Generator\'s depth keeps the MG grounded.',
    strength: 'High shared energy output, mutual respect for gut-response decision-making.',
    growth: 'MG\'s skipping steps can frustrate the Generator\'s methodical pace.',
  },
  'Manifesting Generator|Manifesting Generator': {
    score: 78,
    label: 'Lightning Storm',
    description: 'Two MGs together are a powerhouse — fast-moving, multi-passionate, and highly productive. The key challenge is neither overshoots the other\'s process.',
    strength: 'Enormous capacity for output; shared understanding of non-linear paths.',
    growth: 'Must actively inform each other and avoid trampling the other\'s autonomy.',
  },
  'Generator|Projector': {
    score: 88,
    label: 'Guide & Engine',
    description: 'The classic HD pairing. The Projector sees how the Generator\'s energy can best be used; the Generator provides the Sacral life-force the Projector cannot generate alone.',
    strength: 'Complementary by design — the Projector guides, the Generator powers.',
    growth: 'Generator must wait to be asked before following Projector guidance; Projector must wait to be invited before offering it.',
  },
  'Manifesting Generator|Projector': {
    score: 85,
    label: 'Director & Force',
    description: 'The Projector can help the MG slow down and refine their multi-directional energy. The MG gives the Projector access to abundant creative force.',
    strength: 'The Projector\'s strategic clarity pairs well with the MG\'s speed.',
    growth: 'MG must be willing to be guided; Projector must wait for the invitation.',
  },
  'Generator|Manifestor': {
    score: 70,
    label: 'Impact & Follow-through',
    description: 'The Manifestor initiates and the Generator sustains — a natural succession. Tension arises when the Manifestor forgets to inform or the Generator\'s response lags behind the Manifestor\'s pace.',
    strength: 'Ideas get built. The Manifestor sparks; the Generator carries it forward.',
    growth: 'Manifestor learns to inform; Generator learns not to wait for permission to respond.',
  },
  'Manifesting Generator|Manifestor': {
    score: 68,
    label: 'Two Drivers',
    description: 'Both types are wired to act and initiate in their own ways. Friction is possible when either feels the other is blocking or speeding past them.',
    strength: 'High capacity to move projects into reality quickly.',
    growth: 'Requires clear agreements about who initiates what; informing is critical.',
  },
  'Projector|Manifestor': {
    score: 72,
    label: 'Vision & Impact',
    description: 'The Projector can see the larger picture for the Manifestor\'s initiations; the Manifestor gives the Projector a platform to guide. Both thrive when recognized.',
    strength: 'Strategic pairing with strong visionary capacity.',
    growth: 'Manifestor must invite Projector input; Projector must not try to manage the Manifestor\'s energy.',
  },
  'Generator|Reflector': {
    score: 74,
    label: 'Mirror & Engine',
    description: 'The Reflector samples and reflects the Generator\'s energy like a living health barometer. The Generator provides consistent vitality; the Reflector shows what is truly thriving.',
    strength: 'Grounding and reflective; the Generator helps the Reflector feel productive.',
    growth: 'Generator must give the Reflector time and space — the lunar cycle is real.',
  },
  'Manifesting Generator|Reflector': {
    score: 70,
    label: 'Mirror & Force',
    description: 'The MG\'s fast multi-directional energy can overwhelm or electrify the Reflector. The Reflector reflects back what is correct and what is not working.',
    strength: 'When in sync, the Reflector gives the MG rare objective feedback.',
    growth: 'MG must slow down for the Reflector\'s lunar decision process.',
  },
  'Projector|Projector': {
    score: 65,
    label: 'Two Seers',
    description: 'Two Projectors together have enormous wisdom capacity but no consistent Sacral energy between them. They must be deliberate about managing energy and surrounding themselves with generators.',
    strength: 'Deep mutual understanding; exceptional at seeing each other\'s gifts.',
    growth: 'Need to actively create structure for rest and external energy sources.',
  },
  'Manifestor|Reflector': {
    score: 63,
    label: 'Wave & Mirror',
    description: 'The Manifestor\'s closed aura and the Reflector\'s open one create an unusual dynamic. The Reflector may struggle to get a read on the Manifestor; the Manifestor may not feel the Reflector\'s presence.',
    strength: 'When the Manifestor informs consistently, the Reflector can offer rare neutral perspective.',
    growth: 'Both need to actively communicate — this pairing does not run on instinct.',
  },
  'Manifestor|Manifestor': {
    score: 60,
    label: 'Independent Forces',
    description: 'Two Manifestors value autonomy above all. Together they must build a strong culture of informing or they will continually collide in their independent initiations.',
    strength: 'Neither will wait around or ask permission — fast-moving when aligned.',
    growth: 'Requires explicit agreements about domains and a strong informing practice.',
  },
  'Projector|Reflector': {
    score: 67,
    label: 'Wisdom & Wonder',
    description: 'Both are non-energy types who observe and assess rather than generate. They share a natural appreciation for depth and can support each other\'s slower processing rhythms.',
    strength: 'Mutual patience; both honor the need for the right timing.',
    growth: 'Need to actively cultivate Sacral energy around them and avoid shared depletion.',
  },
  'Reflector|Reflector': {
    score: 62,
    label: 'Rare Mirrors',
    description: 'An extremely rare pairing. Two Reflectors can achieve extraordinary attunement — or find it difficult to anchor because neither has fixed definition to steady the other.',
    strength: 'Profound empathy, deep attunement to each other and the environment.',
    growth: 'Must be intentional about creating stability and surrounding themselves with defined-center people.',
  },
}

export interface CenterInteraction {
  both_defined: string
  a_defined: string   // A defined, B undefined
  both_undefined: string
  score_both_defined: number       // 0–10
  score_complementary: number      // 0–10 (one defined, one not)
  score_both_undefined: number     // 0–10
}

export const CENTER_INTERACTIONS: Record<string, CenterInteraction> = {
  Head: {
    both_defined: 'Consistent mental pressure for both — can become an echo chamber of shared questions. Rich intellectual exchange.',
    a_defined: 'The defined Head provides steady inspiration; the undefined Head amplifies and samples it, potentially getting caught up in the other\'s mental preoccupations.',
    both_undefined: 'Neither is pressured by mental inspiration on their own. Refreshingly free of overthinking when together.',
    score_both_defined: 7, score_complementary: 8, score_both_undefined: 6,
  },
  Ajna: {
    both_defined: 'Fixed perspectives meet — can be stimulating when different viewpoints are respected, or frustrating when neither budges.',
    a_defined: 'The defined Ajna lends conceptual certainty; the undefined Ajna gains a framework for thinking. Risk: the undefined may feel intellectually overshadowed.',
    both_undefined: 'Neither has fixed opinions. Highly adaptable together — decisions can lack conviction without outside input.',
    score_both_defined: 6, score_complementary: 8, score_both_undefined: 7,
  },
  Throat: {
    both_defined: 'Both have reliable, impactful expression. Can be a dynamic communicative pair or a battle for airtime.',
    a_defined: 'The defined Throat gives voice to the undefined Throat. The undefined may feel pressure to speak when with the defined — or feel freed by being heard.',
    both_undefined: 'Both communicate variably. Conversations flow when inspired; silence feels comfortable. Neither forces expression.',
    score_both_defined: 7, score_complementary: 9, score_both_undefined: 6,
  },
  G: {
    both_defined: 'Stable identity and direction for both. The relationship has a clear sense of purpose and place in the world.',
    a_defined: 'The defined G center offers a steady sense of love, direction, and identity that the undefined G can borrow and try on. Grounding.',
    both_undefined: 'Neither has a fixed sense of direction — the relationship is fluid and exploratory. Can be liberating or disorienting.',
    score_both_defined: 8, score_complementary: 9, score_both_undefined: 5,
  },
  Ego: {
    both_defined: 'Two people with consistent willpower. Neither will be pushed around. Strong when aligned; stubborn when not.',
    a_defined: 'The defined Ego stabilizes the undefined one. The undefined Ego may over-promise to please the defined — a pattern to watch.',
    both_undefined: 'Neither has consistent willpower or ego drive. Very little competition or dominance. Can drift without commitment.',
    score_both_defined: 6, score_complementary: 7, score_both_undefined: 7,
  },
  Sacral: {
    both_defined: 'Two Sacral beings — enormous shared life-force. Both understand gut response; the relationship is energized and productive.',
    a_defined: 'The defined Sacral amplifies the undefined Sacral significantly. The undefined becomes more energized around the defined — but may also become conditioned to override their own signals.',
    both_undefined: 'Neither generates sustainable Sacral energy alone. Together they may cycle between bursts of borrowed energy and deep depletion.',
    score_both_defined: 9, score_complementary: 8, score_both_undefined: 4,
  },
  'Solar Plexus': {
    both_defined: 'Both have emotional waves. Emotional clarity requires time for both — if they learn to wait out each other\'s waves, depth and authenticity follow.',
    a_defined: 'The defined Solar Plexus sets an emotional tone the undefined one amplifies and intensifies. Emotional awareness is critical.',
    both_undefined: 'Neither has a defined emotional wave — the relationship can feel emotionally calm but may struggle with emotional depth or authenticity under pressure.',
    score_both_defined: 7, score_complementary: 8, score_both_undefined: 6,
  },
  Spleen: {
    both_defined: 'Mutual instinctive awareness; both read the room and respond to in-the-moment signals. Healthy and grounded together.',
    a_defined: 'The defined Spleen provides a felt sense of safety and wellbeing that the undefined Spleen absorbs. Very supportive.',
    both_undefined: 'Neither has consistent intuitive immunity signals. Both may pick up each other\'s fears and hold them longer than needed.',
    score_both_defined: 8, score_complementary: 9, score_both_undefined: 5,
  },
  Root: {
    both_defined: 'Both handle pressure and stress in their own consistent way. Neither is easily rushed by the other — solid foundation.',
    a_defined: 'The defined Root provides a steady pulse; the undefined Root gets moved by that pressure and may feel driven to resolve things faster.',
    both_undefined: 'Neither has consistent adrenaline pressure. The relationship can be relaxed and unhurried — or avoid necessary urgency.',
    score_both_defined: 8, score_complementary: 7, score_both_undefined: 6,
  },
}
