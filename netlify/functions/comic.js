exports.handler = async (event) => {
  const num = event.queryStringParameters?.num;
  const url = num
    ? `https://xkcd.com/${num}/info.0.json`
    : `https://xkcd.com/info.0.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { statusCode: 404, body: "Comic not found" };
    const data = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return { statusCode: 500, body: "Failed to fetch comic" };
  }
};
