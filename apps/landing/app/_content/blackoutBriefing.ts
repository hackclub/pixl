import "server-only";

export interface BriefingCopy {
  intro: string;
  rules: { title: string; body: string }[];
}

const en: BriefingCopy = {
  intro:
    "Something knocked the power out of the Industrial District. Whatever ships during this Operation needs to be about light — bring it back, any way you can build it. Here is how Operation Blackout works.",
  rules: [
    {
      title: "The window",
      body: "Operation Blackout runs from {start} to {end}. Times are shown in your local time.",
    },
    {
      title: "A rate bonus",
      body: "Hours approved for Blackout earn an extra ${rate}/hr on top of your own normal rate. Everyone gets the same bonus, whatever your normal rate already is.",
    },
    {
      title: "Only work during Blackout counts",
      body: "Time counts from the moment you enter a project until you ship it, and never from before the operation started. Work you did before entering never gets the Blackout rate.",
    },
    {
      title: "Existing projects can join",
      body: "You don't need to start something new. Enter a project you are already building and only the work from now on is eligible.",
    },
    {
      title: "Entering is not approval",
      body: "Checking the box puts your project in the running. A reviewer decides whether it counts and how many hours are approved.",
    },
    {
      title: "Ship before the deadline",
      body: "Ship by {end}. Reviews can happen after the operation ends: a project shipped in time is still judged on the moments it was entered and shipped.",
    },
    {
      title: "Teams",
      body: "Everyone on a team is counted on their own hours and their own rate. Hours are never multiplied across teammates.",
    },
    {
      title: "If changes are requested",
      body: "You keep your place. You get {grace} hours to fix and ship again, and only a small amount of fix work in that window counts. It is not a second Blackout.",
    },
    {
      title: "Unshipping doesn't reset anything",
      body: "Your entry time and your first ship time are locked in the moment they happen.",
    },
  ],
};

const es: BriefingCopy = {
  intro:
    "Algo cortó la energía en el Distrito Industrial. Lo que sea que se entregue durante esta Operación tiene que ser sobre la luz — tráela de vuelta, como sea que la construyas. Así funciona la Operación Blackout.",
  rules: [
    { title: "La ventana", body: "La Operación Blackout va del {start} al {end}. Las horas se muestran en tu hora local." },
    { title: "Un bono de tarifa", body: "Las horas aprobadas para Blackout reciben ${rate}/h extra sobre tu propia tarifa normal. Todos reciben el mismo bono, sea cual sea tu tarifa normal." },
    { title: "Solo cuenta el trabajo durante Blackout", body: "El tiempo cuenta desde que inscribes un proyecto hasta que lo envías, y nunca desde antes de que empezara la operación. El trabajo previo a inscribirte nunca recibe la tarifa Blackout." },
    { title: "Los proyectos existentes pueden unirse", body: "No hace falta empezar algo nuevo. Inscribe un proyecto que ya estás construyendo y solo el trabajo desde ese momento es elegible." },
    { title: "Inscribirse no es aprobación", body: "Marcar la casilla mete tu proyecto en la carrera. Un revisor decide si cuenta y cuántas horas se aprueban." },
    { title: "Envía antes de la fecha límite", body: "Envía antes del {end}. Las revisiones pueden hacerse después de que termine la operación: un proyecto enviado a tiempo se juzga por los momentos en que se inscribió y se envió." },
    { title: "Equipos", body: "Cada persona del equipo cuenta con sus propias horas y su propia tarifa. Las horas nunca se multiplican entre compañeros." },
    { title: "Si piden cambios", body: "Conservas tu lugar. Tienes {grace} horas para corregir y volver a enviar, y solo cuenta una pequeña cantidad de trabajo de corrección en ese periodo. No es un segundo Blackout." },
    { title: "Desenviar no reinicia nada", body: "Tu hora de inscripción y tu primer envío quedan fijados en el momento en que ocurren." },
  ],
};

const fr: BriefingCopy = {
  intro:
    "Quelque chose a coupé le courant dans le District Industriel. Tout ce qui sera livré pendant cette Opération doit parler de lumière — ramène-la, peu importe comment tu la construis. Voici comment fonctionne l'Opération Blackout.",
  rules: [
    { title: "La fenêtre", body: "L'Opération Blackout va du {start} au {end}. Les heures sont affichées dans ton fuseau local." },
    { title: "Un bonus de taux", body: "Les heures approuvées pour Blackout gagnent un bonus de ${rate}/h en plus de ton propre taux habituel. Tout le monde reçoit le même bonus, quel que soit ton taux habituel." },
    { title: "Seul le travail pendant Blackout compte", body: "Le temps compte depuis l'inscription d'un projet jusqu'à son envoi, jamais avant le début de l'opération. Le travail fait avant l'inscription n'obtient jamais le taux Blackout." },
    { title: "Les projets existants peuvent participer", body: "Pas besoin de partir de zéro. Inscris un projet en cours et seul le travail à partir de ce moment est éligible." },
    { title: "S'inscrire n'est pas être approuvé", body: "Cocher la case met ton projet dans la course. Un relecteur décide s'il compte et combien d'heures sont approuvées." },
    { title: "Envoie avant la date limite", body: "Envoie avant le {end}. Les relectures peuvent avoir lieu après la fin : un projet envoyé à temps est jugé sur ses moments d'inscription et d'envoi." },
    { title: "Équipes", body: "Chaque membre est compté sur ses propres heures et son propre taux. Les heures ne sont jamais multipliées entre coéquipiers." },
    { title: "Si des changements sont demandés", body: "Tu gardes ta place. Tu as {grace} heures pour corriger et renvoyer, et seule une petite quantité de travail de correction compte sur cette période. Ce n'est pas un second Blackout." },
    { title: "Annuler l'envoi ne remet rien à zéro", body: "Ton heure d'inscription et ton premier envoi sont figés au moment où ils ont lieu." },
  ],
};

const pt: BriefingCopy = {
  intro:
    "Alguma coisa cortou a energia do Distrito Industrial. O que for lançado durante essa Operação precisa ser sobre luz — traga ela de volta, do jeito que você conseguir construir. Veja como funciona a Operação Blackout.",
  rules: [
    { title: "A janela", body: "A Operação Blackout vai de {start} a {end}. Os horários aparecem no seu horário local." },
    { title: "Um bônus na taxa", body: "As horas aprovadas para o Blackout ganham um bônus de ${rate}/h além da sua própria taxa normal. Todo mundo recebe o mesmo bônus, seja qual for a sua taxa normal." },
    { title: "Só conta o trabalho durante o Blackout", body: "O tempo conta desde que você inscreve um projeto até o envio, e nunca de antes do início da operação. O trabalho feito antes de se inscrever nunca recebe a taxa Blackout." },
    { title: "Projetos existentes podem entrar", body: "Não precisa começar algo novo. Inscreva um projeto que você já está construindo e só o trabalho a partir daí é elegível." },
    { title: "Inscrever-se não é aprovação", body: "Marcar a caixa coloca seu projeto na disputa. Um revisor decide se ele conta e quantas horas são aprovadas." },
    { title: "Envie antes do prazo", body: "Envie até {end}. As revisões podem acontecer depois do fim da operação: um projeto enviado a tempo é julgado pelos momentos de inscrição e envio." },
    { title: "Equipes", body: "Cada pessoa da equipe é contada pelas próprias horas e pela própria taxa. As horas nunca são multiplicadas entre colegas." },
    { title: "Se pedirem mudanças", body: "Você mantém seu lugar. Tem {grace} horas para corrigir e enviar de novo, e só uma pequena quantidade de trabalho de correção nesse período conta. Não é um segundo Blackout." },
    { title: "Desenviar não reinicia nada", body: "Seu horário de inscrição e seu primeiro envio ficam fixados no momento em que acontecem." },
  ],
};

const hi: BriefingCopy = {
  intro:
    "किसी चीज़ ने इंडस्ट्रियल डिस्ट्रिक्ट की बिजली गुल कर दी। इस ऑपरेशन के दौरान जो भी शिप होगा, वह रोशनी के बारे में होना चाहिए — जैसे भी बना सकें, उसे वापस लाएँ। ऑपरेशन ब्लैकआउट ऐसे काम करता है।",
  rules: [
    { title: "समय-सीमा", body: "ऑपरेशन ब्लैकआउट {start} से {end} तक चलता है। समय आपके स्थानीय समय में दिखाया गया है।" },
    { title: "दर बोनस", body: "ब्लैकआउट के लिए मंज़ूर घंटों पर आपकी अपनी सामान्य दर के ऊपर अतिरिक्त ${rate}/घंटा मिलता है। आपकी सामान्य दर चाहे जो हो, सबको एक जैसा बोनस मिलता है।" },
    { title: "सिर्फ़ ब्लैकआउट के दौरान का काम गिना जाता है", body: "समय प्रोजेक्ट में शामिल होने से शिप करने तक गिना जाता है, ऑपरेशन शुरू होने से पहले का कभी नहीं। शामिल होने से पहले किए काम पर ब्लैकआउट दर नहीं मिलती।" },
    { title: "मौजूदा प्रोजेक्ट भी शामिल हो सकते हैं", body: "कुछ नया शुरू करना ज़रूरी नहीं। जो प्रोजेक्ट आप बना रहे हैं उसे शामिल करें, तब से किया गया काम ही पात्र होगा।" },
    { title: "शामिल होना मंज़ूरी नहीं है", body: "बॉक्स टिक करने से आपका प्रोजेक्ट दौड़ में आता है। रिव्यूअर तय करता है कि वह गिना जाएगा या नहीं और कितने घंटे मंज़ूर होंगे।" },
    { title: "डेडलाइन से पहले शिप करें", body: "{end} से पहले शिप करें। रिव्यू ऑपरेशन खत्म होने के बाद भी हो सकता है: समय पर शिप हुए प्रोजेक्ट को शामिल होने और शिप करने के समय के आधार पर आँका जाता है।" },
    { title: "टीमें", body: "टीम के हर सदस्य को उसके अपने घंटों और अपनी दर पर गिना जाता है। घंटे साथियों में कभी गुणा नहीं होते।" },
    { title: "अगर बदलाव माँगे जाएँ", body: "आपकी जगह बनी रहती है। सुधारकर दोबारा शिप करने के लिए {grace} घंटे मिलते हैं, और उस अवधि में सुधार के काम की थोड़ी मात्रा ही गिनी जाती है। यह दूसरा ब्लैकआउट नहीं है।" },
    { title: "अनशिप करने से कुछ रीसेट नहीं होता", body: "आपके शामिल होने का समय और पहली बार शिप करने का समय उसी क्षण पक्के हो जाते हैं।" },
  ],
};

const BY_LANG: Record<string, BriefingCopy> = { en, es, fr, pt, hi };

export function getBriefing(lang: string | null): BriefingCopy {
  return (lang && BY_LANG[lang]) || en;
}
