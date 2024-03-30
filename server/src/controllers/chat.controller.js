import { isValidObjectId } from "mongoose";
import { Chat } from "../models/chat.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asynchHandler.js";
import mongoose from "mongoose";
import { emitSocket } from "../sockets/socket.js";
import { Group } from "../models/group.model.js";

const chatAggregation = () => {
    return [
        {
            $lookup: {
                from: "users",
                localField: "participants",
                foreignField: "_id",
                as: "participants",
                pipeline: [
                    {
                        $project: {
                            password: 0,
                            refreshToken: 0,
                            emailVerifyTokenExpiry: 0,
                            forgotPasswordToken: 0,
                            emailVerifyToken: 0,
                        },
                    },
                ],
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "admins",
                foreignField: "_id",
                as: "admins",
                pipeline: [
                    {
                        $project: {
                            password: 0,
                            refreshToken: 0,
                            emailVerifyTokenExpiry: 0,
                            forgotPasswordToken: 0,
                            emailVerifyToken: 0,
                        },
                    },
                ],
            },
        },
    ];
};

const grouChatAggregation = () => {
    return [
        ...chatAggregation(),
        {
            $lookup: {
                from: "groups",
                localField: "Group",
                foreignField: "_id",
                as: "Group",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "groupCreator",
                            foreignField: "_id",
                            as: "groupCreator",
                            pipeline: [
                                {
                                    $project: {
                                        password: 0,
                                        refreshToken: 0,
                                        emailVerifyTokenExpiry: 0,
                                        forgotPasswordToken: 0,
                                        emailVerifyToken: 0,
                                    },
                                },
                            ],
                        },
                    },
                    {
                        $addFields: {
                            groupCreator: {
                                $first: "$groupCreator",
                            },
                        },
                    },
                ],
            },
        },
        {
            $addFields: {
                Group: {
                    $first: "$Group",
                },
            },
        },
    ];
};

export const createOneToOneChat = asyncHandler(async (req, res) => {
    const { recieverId } = req.params;
    const isValidRecieverId = isValidObjectId(recieverId);
    if (!isValidRecieverId) throw new ApiError(400, "Invalid Reciever Id");

    const reciever = await User.findById(recieverId);
    if (!reciever) throw new ApiError(404, "Reciever Does Not Exits");

    if (recieverId === req.user?._id.toString())
        throw new ApiError(403, "You Cannot Chat With Yourself");

    const existedChat = await Chat.aggregate([
        {
            $match: {
                $and: [
                    {
                        participants: new mongoose.Types.ObjectId(
                            req.user?._id
                        ),
                    },
                    {
                        participants: new mongoose.Types.ObjectId(recieverId),
                    },
                    { isGroup: false },
                    { isCommunity: false },
                ],
            },
        },
        ...chatAggregation(),
    ]);
    console.log("existed Chat:", existedChat);
    if (existedChat.length)
        return res
            .status(200)
            .json(new ApiResponse(200, "Chat Already Existed", existedChat));

    const newChat = await Chat.create({
        name: "oneToOne",
        participants: [req.user?._id, recieverId],
        admins: [req.user?._id],
    });

    const createdChat = await Chat.aggregate([
        [
            {
                $match: {
                    _id: new mongoose.Types.ObjectId(newChat?._id),
                },
            },
            ...chatAggregation(),
        ],
    ]);
    console.log("chat Created:", createdChat);

    if (!createdChat)
        throw new ApiError(
            500,
            "Something Went Wrong While One To One Creating Chat"
        );
    createdChat[0].participants.forEach((participant) => {
        // if (participant?._id === req.user?._id.toString()) return;
        console.log("partis", participant?._id);
        emitSocket(req, participant?._id.toString(), "newChat", createdChat[0]);
    });
    return res
        .status(201)
        .json(
            new ApiResponse(
                201,
                "One To One Chat Created SuccessFully",
                createdChat
            )
        );
});

export const createGroup = asyncHandler(async (req, res) => {
    const { name, participants } = req.body;
    if (!name || !participants.length)
        throw new ApiError(400, "Name and Participants are Required");

    const members = [...new Set([...participants, req.user?._id.toString()])];
    if (members?.length < 3)
        throw new ApiError(403, "Group Should have at least 3 members");

    const isGroupExisted = await Group.aggregate([
        {
            $match: {
                $and: [{ name }, { groupCreator: req?.user?._id }],
            },
        },
    ]);
    if (isGroupExisted.length) throw new ApiError(403, "Group Already Created");

    const group = await Group.create({ name, groupCreator: req.user?._id });
    const groupCreated = await Group.findById(group?._id);
    if (!groupCreated)
        throw new ApiError(500, "Something Went Wrong While Creating Group");

    const newGroupChat = await Chat.create({
        name: "GroupChat",
        admins: [req.user?._id],
        isGroup: true,
        Group: groupCreated?._id,
        participants: members,
    });

    const groupChat = await Chat.aggregate([
        {
            $match: { _id: new mongoose.Types.ObjectId(newGroupChat?._id) },
        },
        ...grouChatAggregation(),
    ]);

    if (!groupChat.length)
        throw new ApiError(
            500,
            "Something Went Wrong While Creating Group Chat"
        );

    members.forEach((id) => {
        if (id == req.user?._id.toString()) return;
        emitSocket(req, id, "newChat", groupChat[0]);
    });

    return res
        .status(201)
        .json(
            new ApiResponse(
                201,
                "Group Chat Created SuccessFully",
                groupChat[0]
            )
        );
});

export const addNewParticipantsInGroupChat = asyncHandler(async (req, res) => {
    const { participants, chatId } = req.body;
    if (!chatId || !participants.length)
        throw new ApiError(403, "ChatID and Participants are Required");

    if (!isValidObjectId(chatId)) throw new ApiError(400, "Invalid ChatId");

    const members = [...new Set(participants)];
    if (!members.length) throw new ApiError(403, "No Participants are There!");

    members.forEach((id) => {
        if (!isValidObjectId(id))
            throw new ApiError(400, `Invalid Participant Id :${id}`);
    });

    if (members.includes(req.user?._id.toString()))
        throw new ApiError(400, "Admin Cannot Be Participants");

    const groupChat = await Chat.findById(chatId);
    if (!groupChat) throw new ApiError(404, "Group Chat Does Not Exists");

    const admins = groupChat.admins;
    const oldParticipants = groupChat.participants;
    if (!admins.includes(req.user?._id.toString()))
        throw new ApiError(
            401,
            "Unauthorized Access To Add New Participants. Requires Admin Permissions"
        );

    members.forEach((id) => {
        if (oldParticipants.includes(id))
            throw new ApiError(
                400,
                `User Already in Chat Group with ID :${id}`
            );
    });

    groupChat.participants = [...groupChat.participants, ...members];
    groupChat.save({ validateBeforeSave: false });
    const chat = await Chat.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(chatId),
            },
        },
        ...grouChatAggregation(),
    ]);
    if (!chat.length)
        throw new ApiError(
            500,
            "Something Went Wrong While Adding Participants"
        );
    members.forEach((id) => {
        emitSocket(req, id, "newChat", chat[0]);
    });

    return res
        .status(201)
        .json(new ApiResponse(201, "Participants Added SuccessFully", chat[0]));
});

export const removeParticipantFromGroupChat = asyncHandler(async (req, res) => {
    const { chatId, participants } = req.body;
    if (!chatId || !participants.length)
        throw new ApiError(403, "ChatId And Participants Id are Required");

    if (!isValidObjectId(chatId)) throw new ApiError(400, "Invalid ChatId");

    const members = [...new Set(participants)];
    if (!members.length) throw new ApiError(403, "Participants Id is Required");

    members.forEach((id) => {
        if (!isValidObjectId(id))
            throw new ApiError(400, `Invalid Participant Id :${id}`);
    });
    if (members.includes(req.user?._id.toString()))
        throw new ApiError(400, "Admin Cannot Be Participants");

    const groupChat = await Chat.findById(chatId);
    const admins = groupChat.admins;
    const oldParticipants = groupChat.participants;
    if (!admins.includes(req.user?._id.toString()))
        throw new ApiError(
            401,
            "Unauthorized Access to Remove Participants. Require Admin Permissions"
        );

    const newParticipants = oldParticipants.filter((id) => {
        if (members.includes(id.toString())) return null;
        else return id;
    });

    groupChat.participants = newParticipants;
    groupChat.save({ validateBeforeSave: false });

    const chat = await Chat.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(chatId),
            },
        },
        ...grouChatAggregation(),
    ]);
    if (!chat.length)
        throw new ApiError(
            500,
            "Something Went Wrong While Removing Participants"
        );

    members.forEach((id) => {
        emitSocket(req, id, "leaveChat", chat[0]);
    });

    return res
        .status(200)
        .json(
            new ApiResponse(200, "Participants Removed SuccessFully", chat[0])
        );
});