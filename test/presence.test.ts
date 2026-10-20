import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyPresence } from "../presence.ts";

test("return phrases count as back, ordinary prompts do not", () => {
	for (const text of ["Je suis de retour", "je suis de retour, on reprend", "re", "Re !", "back", "I'm back.", "Me revoilà", "rebonjour"]) {
		assert.equal(classifyPresence(text).back, true, text);
	}
	for (const text of ["re-read this file", "back to the PR please", "retour sur la PR", "rebase it", "je suis la discussion"]) {
		assert.equal(classifyPresence(text).back, false, text);
	}
});

test("departure phrases count as leaving, wherever they sit in the message", () => {
	for (const text of [
		"Je file",
		"je part manger",
		"je pars",
		"Bon, j'y vais",
		"j’y go",
		"je m'absente une demie heure",
		"OK bon commence l'implem, je m'absente une demie heure là",
		"je reviens dans 20 min",
		"je reviens dans une heure",
		"pause déj",
		"à plus",
		"ok a+",
		"afk 10 min",
		"brb",
		"I'm off, keep going",
		"je vais y aller",
	]) {
		assert.equal(classifyPresence(text).leave, true, text);
	}
});

test("look-alike phrases do not count as leaving", () => {
	for (const text of [
		"je pars du principe que c'est bon",
		"je pars sur l'option A",
		"je pars pas tout de suite",
		"il y a plus de tests à écrire",
		"the file is missing",
		"je reviens dans le fichier index.ts",
		"je reviens sur ce point",
		"go ahead",
	]) {
		assert.equal(classifyPresence(text).leave, false, text);
	}
});
