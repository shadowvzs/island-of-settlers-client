import { msg } from "@lingui/core/macro";

/** Support window copy: why the project is free, where donations go and the two payment links. */
export const SUPPORT_MESSAGES = {
  call: msg({
    id: "support.call",
    message: "If you enjoy the game, you can support the project with Revolut or PayPal. Every contribution helps, whatever the size."
  }),
  cost: msg({
    id: "support.cost",
    message: "Donations go toward development costs - in particular the AI tools and services I use, which are a significant part of the monthly bill."
  }),
  lead: msg({
    id: "support.lead",
    message: "Island of Settlers is a free project, built with care over countless hours."
  }),
  paypal: msg({ id: "support.paypal", message: "Support via PayPal" }),
  qr: msg({
    id: "support.qr",
    message: "Scan the QR code with your phone to open the Revolut donation page."
  }),
  qrAlt: msg({ id: "support.qrAlt", message: "Revolut donation QR code" }),
  revolut: msg({ id: "support.revolut", message: "Support via Revolut" }),
  thanks: msg({
    id: "support.thanks",
    message: "Thank you for playing, and for helping the island grow."
  }),
  title: msg({ id: "support.title", message: "Support Island of Settlers" })
} as const;
